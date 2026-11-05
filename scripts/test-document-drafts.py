import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('drafts', Path(__file__).with_name('document-drafts.py'))
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class DocumentDraftTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.workspace = self.root / 'copies'
        self.original = b'one\ntwo\nthree\nfour\nfive\n'
        self.document = self.source / 'note.md'
        self.document.write_bytes(self.original)
        self.manifest = d.prepare(self.source, self.workspace, 'test', ['note.md'])

    def draft(self, data):
        (self.workspace / 'draft/note.md').write_bytes(data)

    def reconcile(self, resolved=()):
        return d.reconcile(self.workspace, d.load(self.workspace), resolved)['files'][0]

    def test_noop_and_latest_source(self):
        self.reconcile()
        self.assertEqual([], d.export(self.workspace, self.manifest))
        latest = self.original.replace(b'two', b'latest')
        self.document.write_bytes(latest)
        item = self.reconcile()
        self.assertEqual(latest, (self.workspace / item['candidate']).read_bytes())
        self.assertEqual([], d.export(self.workspace, self.manifest))

    def test_real_disjoint_merge_and_current_hash(self):
        latest = self.original.replace(b'one', b'latest')
        self.document.write_bytes(latest)
        self.draft(self.original.replace(b'five', b'draft'))
        item = self.reconcile()
        self.assertFalse(item['conflict'])
        exported = d.export(self.workspace, self.manifest)[0]
        self.assertEqual(d.digest(latest), exported['before_sha256'])
        self.assertEqual(latest.replace(b'five', b'draft'), base64.b64decode(exported['after_base64']))
        self.assertEqual(latest, self.document.read_bytes())

    def test_equal_edits(self):
        changed = b'equal\n'
        self.document.write_bytes(changed)
        self.draft(changed)
        self.reconcile()
        self.assertEqual([], d.export(self.workspace, self.manifest))

    def test_conflict_preserved_and_explicit_resolution(self):
        self.document.write_bytes(b'source\n')
        self.draft(b'draft\n')
        item = self.reconcile()
        self.assertTrue(item['conflict'])
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        candidate = self.workspace / item['candidate']
        candidate.write_bytes(b'human resolution\n')
        next_item = self.reconcile()
        self.assertEqual(b'human resolution\n', (self.workspace / next_item['candidate']).read_bytes())
        self.assertTrue(next_item['conflict'])
        self.assertFalse(self.reconcile(['note.md'])['conflict'])
        self.assertEqual(b'human resolution\n', base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64']))
        self.assertTrue(candidate.exists())

    def test_stale_and_missing_source(self):
        self.reconcile()
        self.document.write_bytes(b'changed\n')
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        self.document.unlink()
        self.assertIn('error', self.reconcile())
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)

    def test_resume_preserves_draft_and_baseline_integrity(self):
        self.draft(b'work\n')
        d.prepare(self.source, self.workspace, 'test', ['note.md'])
        self.assertEqual(b'work\n', (self.workspace / 'draft/note.md').read_bytes())
        (self.workspace / 'base/note.md').write_bytes(b'tamper')
        with self.assertRaises(ValueError):
            d.load(self.workspace)

    def test_path_validation_and_limits(self):
        for name in ('../note.md', '/note.md', '.git/info.md', 'x/../note.md', 'x\\note.md', 'x.env', 'config.json'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                d.safe_path(self.source, name)
        with self.assertRaises(ValueError):
            d.prepare(self.source, self.root / 'other', 't', ['note.md', 'NOTE.md'])
        with self.assertRaises(ValueError):
            d.prepare(self.source, self.source / 'nested', 't', ['note.md'])
        with self.assertRaises(ValueError):
            d.prepare(self.source, self.root / 'other', 't', ['note.md'] * 101)

    def test_symlink_rejected(self):
        link = self.source / 'link.md'
        try:
            link.symlink_to(self.document)
        except OSError:
            self.skipTest('OS does not permit unprivileged symlink creation')
        with self.assertRaises(ValueError):
            d.safe_path(self.source, 'link.md')

    def test_lock_never_reclaimed(self):
        with d.locked(self.workspace):
            with self.assertRaises(FileExistsError):
                with d.locked(self.workspace):
                    self.fail('lock acquired twice')
        self.assertFalse((self.workspace / '.draft-lock').exists())

    def test_cli_requires_explicit_matching_root(self):
        script = str(Path(__file__).with_name('document-drafts.py'))
        for arguments in (['status', str(self.workspace)], ['status', str(self.workspace), '--source', str(self.root)]):
            result = subprocess.run([sys.executable, script, *arguments], capture_output=True)
            self.assertNotEqual(0, result.returncode)
        result = subprocess.run([sys.executable, script, 'status', str(self.workspace), '--source', str(self.source)], capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_clean_candidate_edit_requires_explicit_review(self):
        self.draft(b'proposed\n')
        item = self.reconcile()
        candidate = self.workspace / item['candidate']
        candidate.write_bytes(b'human edit\n')
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        self.assertIn('error', self.reconcile())
        self.assertFalse(self.reconcile(['note.md'])['conflict'])
        self.assertEqual(b'human edit\n', base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64']))
        self.assertEqual(b'human edit\n', candidate.read_bytes())

    def test_acknowledged_candidate_survives_later_source_change(self):
        base = b''.join(f'line {i}\n'.encode() for i in range(1, 16))
        self.document.write_bytes(base)
        self.workspace = self.root / 'reviewed-source'
        self.manifest = d.prepare(self.source, self.workspace, 'reviewed', ['note.md'])
        self.draft(base.replace(b'line 1\n', b'drafted one\n'))
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(candidate.read_bytes().replace(b'line 5\n', b'reviewed five\n'))
        self.assertFalse(self.reconcile(['note.md'])['conflict'])
        latest = base.replace(b'line 12\n', b'latest twelve\n')
        self.document.write_bytes(latest)
        result = self.reconcile()
        self.assertFalse(result['conflict'], result)
        proposed = base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64'])
        self.assertIn(b'reviewed five\n', proposed)
        self.assertIn(b'latest twelve\n', proposed)
        self.assertIn(b'drafted one\n', proposed)
        self.assertEqual(latest, self.document.read_bytes())
        self.assertIn(b'reviewed five\n', candidate.read_bytes())
        latest = latest.replace(b'line 15\n', b'latest fifteen\n')
        self.document.write_bytes(latest)
        self.assertFalse(self.reconcile()['conflict'])
        proposed = base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64'])
        self.assertIn(b'reviewed five\n', proposed)
        self.assertIn(b'latest twelve\n', proposed)
        self.assertIn(b'latest fifteen\n', proposed)

    def test_acknowledged_candidate_survives_later_draft_change(self):
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(self.original.replace(b'two\n', b'reviewed two\n'))
        self.assertFalse(self.reconcile(['note.md'])['conflict'])
        self.draft(self.original.replace(b'five\n', b'drafted five\n'))
        result = self.reconcile()
        self.assertFalse(result['conflict'], result)
        proposed = base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64'])
        self.assertIn(b'reviewed two\n', proposed)
        self.assertIn(b'drafted five\n', proposed)

    def test_reviewed_edit_conflicts_with_later_overlapping_source(self):
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(self.original.replace(b'two\n', b'reviewed two\n'))
        self.reconcile(['note.md'])
        self.document.write_bytes(self.original.replace(b'two\n', b'peer two\n'))
        result = self.reconcile()
        self.assertTrue(result['conflict'])
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        self.assertIn(b'reviewed two', (self.workspace / result['candidate']).read_bytes())

    def test_source_revert_is_preserved_with_reviewed_edit(self):
        base = b''.join(f'line {i}\n'.encode() for i in range(1, 16))
        self.document.write_bytes(base)
        self.workspace = self.root / 'source-revert'
        self.manifest = d.prepare(self.source, self.workspace, 'revert', ['note.md'])
        self.document.write_bytes(base.replace(b'line 1\n', b'peer one\n'))
        self.draft(base.replace(b'line 12\n', b'drafted twelve\n'))
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(candidate.read_bytes().replace(b'line 6\n', b'reviewed six\n'))
        self.reconcile(['note.md'])
        self.document.write_bytes(base)
        self.assertFalse(self.reconcile()['conflict'])
        proposed = base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64'])
        self.assertIn(b'line 1\n', proposed)
        self.assertNotIn(b'peer one\n', proposed)
        self.assertIn(b'reviewed six\n', proposed)
        self.assertIn(b'drafted twelve\n', proposed)

    def test_both_inputs_changed_require_review_of_retained_candidate(self):
        base = b''.join(f'line {i}\n'.encode() for i in range(1, 19))
        self.document.write_bytes(base)
        self.workspace = self.root / 'both-inputs'
        self.manifest = d.prepare(self.source, self.workspace, 'both', ['note.md'])
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(base.replace(b'line 8\n', b'reviewed eight\n'))
        self.reconcile(['note.md'])
        self.document.write_bytes(base.replace(b'line 17\n', b'peer seventeen\n'))
        self.draft(base.replace(b'line 1\n', b'drafted one\n'))
        result = self.reconcile()
        self.assertTrue(result['conflict'])
        self.assertIn('both', result.get('review_reason', ''))
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        proposed = (self.workspace / result['candidate']).read_bytes()
        self.assertIn(b'reviewed eight\n', proposed)
        self.assertIn(b'peer seventeen\n', proposed)
        self.assertIn(b'drafted one\n', proposed)
        self.assertNotIn(b'<<<<<<< ', proposed)
        self.assertIn('both', self.reconcile().get('review_reason') or '')
        self.assertFalse(self.reconcile(['note.md'])['conflict'])


    def _assert_review_reason_survives_one_input_change(self, changed_input):
        base = b''.join(f'line {i}\n'.encode() for i in range(1, 25))
        self.document.write_bytes(base)
        self.workspace = self.root / f'reason-{changed_input}'
        self.manifest = d.prepare(self.source, self.workspace, 'reason', ['note.md'])
        initial = self.reconcile()
        candidate = self.workspace / initial['candidate']
        candidate.write_bytes(base.replace(b'line 12\n', b'reviewed twelve\n'))
        self.reconcile(['note.md'])

        source = base.replace(b'line 21\n', b'peer twenty-one\n')
        draft = base.replace(b'line 1\n', b'drafted one\n')
        self.document.write_bytes(source)
        self.draft(draft)
        blocked = self.reconcile()
        self.assertTrue(blocked['conflict'])
        reason = blocked['review_reason']
        self.assertIn('both source and draft changed', reason)
        retained = {
            key: (self.workspace / blocked[key]).read_bytes()
            for key in ('candidate', 'source_snapshot', 'draft_snapshot')
        }

        if changed_input == 'source':
            source = source.replace(b'line 23\n', b'later source twenty-three\n')
            expected_later = b'later source twenty-three\n'
            self.document.write_bytes(source)
        else:
            draft = draft.replace(b'line 3\n', b'later draft three\n')
            expected_later = b'later draft three\n'
            self.draft(draft)

        result = self.reconcile()
        self.assertNotIn('error', result)
        self.assertTrue(result['conflict'])
        self.assertEqual(reason, result['review_reason'])
        proposed = (self.workspace / result['candidate']).read_bytes()
        for expected in (
            b'reviewed twelve\n', b'peer twenty-one\n',
            b'drafted one\n', expected_later,
        ):
            self.assertIn(expected, proposed)
        self.assertNotIn(b'<<<<<<< ', proposed)
        for key, contents in retained.items():
            self.assertEqual(contents, (self.workspace / blocked[key]).read_bytes())
        with self.assertRaisesRegex(ValueError, 'unresolved conflicts'):
            d.export(self.workspace, self.manifest)
        self.assertEqual(reason, self.reconcile()['review_reason'])

        resolved = self.reconcile(['note.md'])
        self.assertFalse(resolved['conflict'])
        self.assertIsNone(resolved['review_reason'])
        exported = d.export(self.workspace, self.manifest)
        self.assertEqual(1, len(exported))
        self.assertEqual(proposed, base64.b64decode(exported[0]['after_base64']))
        self.assertEqual(d.digest(source), exported[0]['before_sha256'])
        self.assertEqual(source, self.document.read_bytes())

    def test_review_reason_survives_later_source_only_change(self):
        self._assert_review_reason_survives_one_input_change('source')

    def test_review_reason_survives_later_draft_only_change(self):
        self._assert_review_reason_survives_one_input_change('draft')

    def test_legacy_reconciliation_without_input_snapshots_fails_closed(self):
        self.reconcile()
        record_path = self.workspace / 'reconciliation.json'
        record = json.loads(record_path.read_text())
        record['files'][0].pop('source_snapshot', None)
        record['files'][0].pop('draft_snapshot', None)
        record_path.write_text(json.dumps(record))
        self.document.write_bytes(self.original + b'peer change\n')
        self.assertIn('snapshot', self.reconcile().get('error', ''))
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)

    def test_changed_input_snapshot_blocks_rebase_and_export(self):
        initial = self.reconcile()
        snapshot = self.workspace / initial['source_snapshot']
        snapshot.write_bytes(b'tampered earlier source\n')
        self.document.write_bytes(self.original + b'new source\n')
        self.assertIn('snapshot changed', self.reconcile().get('error', ''))
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)

    def test_both_input_cancellation_retains_versions_for_explicit_review(self):
        self.draft(self.original.replace(b'three\n', b'old draft three\n'))
        self.reconcile()
        self.document.write_bytes(self.original.replace(b'three\n', b'old draft three\n'))
        self.draft(self.original)
        result = self.reconcile()
        self.assertTrue(result['conflict'])
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        self.assertIn(b'old draft three\n', (self.workspace / result['source_snapshot']).read_bytes())
        self.assertEqual(self.original, (self.workspace / result['draft_snapshot']).read_bytes())

    def test_multiple_real_git_conflicts_are_preserved(self):
        base = b'first\n' + b'unchanged\n' * 12 + b'last\n'
        # Fresh workspace preserves the actual baseline for this fixture.
        self.document.write_bytes(base)
        self.workspace = self.root / 'multiple'
        self.manifest = d.prepare(self.source, self.workspace, 'multi', ['note.md'])
        self.document.write_bytes(base.replace(b'first', b'source-first').replace(b'last', b'source-last'))
        self.draft(base.replace(b'first', b'draft-first').replace(b'last', b'draft-last'))
        item = self.reconcile()
        self.assertTrue(item['conflict'])
        self.assertNotIn('error', item)
        self.assertEqual(2, (self.workspace / item['candidate']).read_bytes().count(b'<<<<<<<'))

    def test_manifest_disjointness_and_limits_revalidated(self):
        path = self.workspace / 'manifest.json'
        manifest = dict(self.manifest)
        manifest['source'] = str(self.workspace)
        path.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            d.load(self.workspace)
        manifest['source'] = str(self.source)
        manifest['files'] = []
        path.write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            d.load(self.workspace)
        path.write_text(json.dumps(self.manifest))
        old_limit = d.MAX_BYTES
        try:
            d.MAX_BYTES = len(self.original) - 1
            with self.assertRaises(ValueError):
                d.load(self.workspace)
        finally:
            d.MAX_BYTES = old_limit

    def test_metadata_and_workspace_links_rejected(self):
        outside = self.root / 'outside.json'
        outside.write_text(json.dumps(self.manifest))
        probe = self.root / 'probe'
        try:
            probe.symlink_to(self.source, target_is_directory=True)
        except OSError:
            self.skipTest('OS does not permit symlink creation')
        with self.assertRaises(ValueError):
            d.check_root(probe)
        for name in ('manifest.json', 'reconciliation.json'):
            path = self.workspace / name
            previous = path.read_bytes() if path.exists() else None
            if path.exists():
                path.unlink()
            path.symlink_to(outside)
            with self.assertRaises(ValueError):
                d.metadata_path(self.workspace, name)
            path.unlink()
            if previous is not None:
                path.write_bytes(previous)

    def test_native_cli_export_has_absolute_verified_path(self):
        self.draft(b'proposed\n')
        self.reconcile()
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('document-drafts.py')), 'export', str(self.workspace), '--source', str(self.source)], capture_output=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(str(self.document), json.loads(result.stdout)[0]['path'])
        self.assertEqual(self.original, self.document.read_bytes())

    def test_cli_rejects_source_overlap_before_lock_write(self):
        with patch.object(sys, 'argv', ['document-drafts.py', 'status', str(self.workspace), '--source', str(self.root)]), patch.object(d, 'locked') as lock:
            self.assertEqual(1, d.main())
            lock.assert_not_called()
        self.assertFalse((self.workspace / '.draft-lock').exists())

    def test_resolution_preserves_legitimate_equals_heading(self):
        self.document.write_bytes(b'source\n')
        self.draft(b'draft\n')
        item = self.reconcile()
        candidate = self.workspace / item['candidate']
        self.assertIn('conflict markers remain', self.reconcile(['note.md'])['error'])
        with self.assertRaises(ValueError):
            d.export(self.workspace, self.manifest)
        candidate.write_bytes(b'Heading\n=======\nProse containing ======= and <<<<<<< tokens.\n')
        self.assertFalse(self.reconcile(['note.md'])['conflict'])
        self.assertIn(b'=======', base64.b64decode(d.export(self.workspace, self.manifest)[0]['after_base64']))


if __name__ == '__main__':
    unittest.main()
