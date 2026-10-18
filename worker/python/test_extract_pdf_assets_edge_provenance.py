"""Native PDF edge rows require ruled-cell provenance; ambiguous text is retained."""
import os
import sys
import tempfile
import unittest
sys.path.insert(0, os.path.dirname(__file__))
import extract_pdf_assets as e

class EdgeProvenanceTests(unittest.TestCase):
    def recover(self, lines, ruled=False, fill_only=False, invisible=False):
        doc = e.fitz.open()
        page = doc.new_page(width=595, height=842)
        for x, y, text in lines:
            page.insert_text((x, y), text, fontsize=9)
        if ruled:
            for y in (202, 246):
                page.draw_line((50, y), (560, y))
            for x in (50, 120, 310, 560):
                page.draw_line((x, 202), (x, 246))
        if fill_only or invisible:
            for left,right in ((50,120),(120,310),(310,560)):
                page.draw_rect(e.fitz.Rect(left,202,right,246), color=None if fill_only else (0,0,0),
                               fill=(.9,.9,.9), stroke_opacity=0 if invisible else 1)
        # Exercise serialized PDF coordinates rather than mocked text segments.
        data = doc.tobytes()
        doc.close()
        with e.fitz.open(stream=data, filetype='pdf') as native:
            unassigned = []
            top, bottom = e._recover_table_rows_split(native[0], e.fitz.Rect(50,120,560,200),
                e.fitz.Rect(50,120,560,260), [['Score','State','Action']], 3,
                [(50,120),(120,310),(310,560)], unassigned_segments=unassigned)
            return top + bottom, unassigned

    def test_unruled_notes_are_retained_without_clinical_cell_assignment(self):
        for note in ('see note', '1 see note below', '- Reference note'):
            with self.subTest(note=note):
                rows, unassigned = self.recover([(54,218,'5'),(124,218,'Aroused'),(314,218,'Call'),(54,230,note)])
                self.assertEqual(rows, [])
                self.assertIn(note, [s['text'] for s in unassigned])
                self.assertTrue(all(len(s['bbox']) == 4 for s in unassigned))

    def test_fills_and_invisible_paths_do_not_authorize_clinical_cells(self):
        for option in ({'fill_only':True},{'invisible':True}):
            rows, unassigned = self.recover([(54,218,'ABC'),(124,218,'abbreviation key'),(314,218,'see note')], **option)
            self.assertEqual(rows, [])
            self.assertEqual(len(unassigned), 3)

    def test_note_in_same_native_block_survives_page_text_rebuild(self):
        doc = e.fitz.open()
        page = doc.new_page(width=595,height=842)
        for y in (100,120,135): page.draw_line((50,y),(560,y))
        for x in (50,220,560): page.draw_line((x,100),(x,135))
        page.insert_text((54,116),'Drug\nMedication A\nDo not repeat',fontsize=9)
        page.insert_text((224,116),'Action\nReview carefully',fontsize=9)
        candidates=e.likely_table_candidates(page)
        self.assertTrue(candidates)
        text=e.table_aware_page_text(page,candidates)
        self.assertIn('Do not repeat',text)
        self.assertIn('Medication A',text)
        doc.close()

    def test_multicolumn_abbreviation_key_does_not_become_a_row(self):
        rows, unassigned = self.recover([(54,218,'ABC'),(124,218,'abbreviation key')])
        self.assertEqual(rows, [])
        self.assertEqual([s['text'] for s in unassigned], ['ABC','abbreviation key'])

    def test_ruled_deliberate_dose_and_bullet_keep_their_cell(self):
        rows, unassigned = self.recover([(54,218,'5'),(124,218,'Aroused'),(314,218,'Drug'),
            (314,230,'1 to 2 mg orally'),(314,242,'- repeat once')], ruled=True)
        self.assertEqual(rows, [['5','Aroused','Drug 1 to 2 mg orally - repeat once']])
        self.assertEqual(unassigned, [])

    def test_text_below_ruled_table_is_not_joined_even_if_aligned(self):
        rows, unassigned = self.recover([(54,218,'5'),(124,218,'Aroused'),(314,218,'Call'),
            (54,258,'see note')], ruled=True)
        self.assertEqual(rows, [['5','Aroused','Call']])
        self.assertEqual([s['text'] for s in unassigned], ['see note'])

if __name__ == '__main__':
    unittest.main()
