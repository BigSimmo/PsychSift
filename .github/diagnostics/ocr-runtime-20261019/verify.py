"""Offline actual owner tests plus default-off source invariance. Invoked only under an approved bounded wrapper."""
import argparse,copy,hashlib,importlib.util,json,os,resource,shutil,signal,sys,time,unittest
from pathlib import Path
args=argparse.ArgumentParser();args.add_argument('--candidate-root',required=True);args.add_argument('--baseline-source',required=True);args.add_argument('--fixtures-root',required=True);args.add_argument('--out',required=True);args.add_argument('--parser-site');args.add_argument('--scope',choices=('core','owner'),default='core');a=args.parse_args()
def stop(*_):raise TimeoutError("approved wrapper terminated current phase")
signal.signal(signal.SIGTERM,stop)
START=time.monotonic();OUT=Path(a.out);OUT.mkdir(exist_ok=False);C=Path(a.candidate_root);PY=C/'worker/python';FIX=Path(a.fixtures_root)
# The local diagnostic can use already-present host native packages and the retained pure-Python wrapper.
# Preload host ABI packages before appending a parser subset built for another Python ABI.
import fitz
from PIL import Image
if a.parser_site:sys.path.append(a.parser_site)
import pytesseract
sys.path.insert(0,str(PY));import extract_pdf_assets as ext
status={'scope':'actual focused owner tests and four unchanged default-off fixtures; no provider/re-index/clinical activation','runtime':{'python':sys.version,'pymupdf':fitz.VersionBind,'mupdf':fitz.VersionFitz,'pillow':Image.__version__,'pytesseract':pytesseract.__version__},'gatedResults':[],'defaultOff':[]}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(a.baseline_source)=='a0684a809905dd4f19bbe148c39c4140b342a142a6301ac826b70e1cd494d13a','baseline current-main source mismatch'
status['candidateSourceSha256']=sha(PY/'extract_pdf_assets.py');status['baselineSourceSha256']=sha(a.baseline_source)
real_extract=ext.extract
def observe_extract(*values,**kwargs):
 result=real_extract(*values,**kwargs)
 if os.environ.get('PDF_RASTER_TABLE_OCR')=='1':
  n=len(status['gatedResults'])+1;pdf=OUT/f'gated-{n}.pdf';payload=OUT/f'gated-{n}.json'
  shutil.copyfile(values[0],pdf);payload.write_text(json.dumps(result,indent=2)+'\n')
  status['gatedResults'].append({'payload':payload.name,'input':pdf.name,'inputSha256':sha(pdf),'payloadSha256':sha(payload),'sourceStatus':[page['metadata']['source_provenance']['ocr']['status'] for page in result['pages']]})
 return result
ext.extract=observe_extract
try:
 os.environ['PDF_RASTER_TABLE_OCR']='0'
 # Fail before running any engine if a copied public owner fixture is absent.
 for fixture in ("synthetic-lithium-monitoring.pdf", "malformed-table-crop-page-edge.pdf"):
  assert (PY/"fixtures"/fixture).is_file(),"required existing public fixture missing: "+fixture
 from test_extract_pdf_assets_raster_tables import RasterGridRealOcrTests, RasterGridGeometryTests, RasterModelContractTests
 loader=unittest.defaultTestLoader
 names=["test_gated_merged_scan_keeps_exponent_cells_and_owning_rows", "test_gated_wrapped_scan_retains_all_existing_source_cells", "test_outside_multicolumn_prose_keeps_its_own_qualifiers"]
 suite=unittest.TestSuite([RasterGridRealOcrTests(name) for name in names])
 suite.addTests(loader.loadTestsFromTestCase(RasterModelContractTests))
 suite.addTests(loader.loadTestsFromTestCase(RasterGridGeometryTests))
 if a.scope=="owner":
  for file in sorted(PY.glob("test_extract_pdf_assets_*.py")):
   if file.name!="test_extract_pdf_assets_raster_tables.py":suite.addTests(loader.loadTestsFromName(file.stem))
 status["selectedScope"]=a.scope;status["plannedOwnerTestCount"]=suite.countTestCases()
 class TimedResult(unittest.TextTestResult):
  def startTest(self,test):
   self._begun=time.monotonic();event={"event":"start","test":test.id(),"elapsedSeconds":round(self._begun-START,3)}
   with (OUT/"test-events.jsonl").open("a") as stream:stream.write(json.dumps(event)+"\n")
   super().startTest(test)
  def stopTest(self,test):
   event={"event":"stop","test":test.id(),"durationSeconds":round(time.monotonic()-self._begun,3),"elapsedSeconds":round(time.monotonic()-START,3)}
   with (OUT/"test-events.jsonl").open("a") as stream:stream.write(json.dumps(event)+"\n")
   super().stopTest(test)
  def addFailure(self,test,err):
   super().addFailure(test,err)
   (OUT/"first-test-failure.txt").write_text(self._exc_info_to_string(err,test))
  def addError(self,test,err):
   super().addError(test,err)
   (OUT/"first-test-error.txt").write_text(self._exc_info_to_string(err,test))
 result=unittest.TextTestRunner(verbosity=2,failfast=True,resultclass=TimedResult).run(suite)
 status['ownerTests']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'success':result.wasSuccessful(),'skippedTests':[(str(test),reason) for test,reason in result.skipped]}
 assert result.wasSuccessful() and not result.skipped,'owning Python tests failed or skipped'
 assert len(status['gatedResults'])==3,'all three actual source tests must execute'
 spec=importlib.util.spec_from_file_location('baseline_current_main',a.baseline_source);baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
 manifest=json.loads((FIX/'source-manifest.json').read_text())
 def normalized(result):
  item=copy.deepcopy(result);item['extractor'].pop('version')
  for page in item['pages']:page['metadata']['source_provenance']['producer'].pop('scriptSha256')
  for image in item['images']:
   path=Path(image['path']);image['path']=path.name
   with Image.open(path) as raster:rgba=raster.convert('RGBA');image['verifiedDecodedPixelsSha256']=hashlib.sha256(rgba.tobytes()).hexdigest();image['verifiedDecodedPixelSize']=list(rgba.size)
   image['verifiedEncodedBytesSha256']=sha(path)
  return item
 for case in manifest['cases']:
  source=FIX/case['file'];assert sha(source)==case['sha256']
  begun=time.monotonic()
  old=baseline.extract(str(source),str(OUT/f"baseline-{case['id']}"));middle=time.monotonic()
  new=real_extract(str(source),str(OUT/f"candidate-{case['id']}"));finished=time.monotonic()
  status.setdefault("defaultOffTimings",[]).append({"id":case["id"],"baselineSeconds":round(middle-begun,3),"candidateSeconds":round(finished-middle,3),"elapsedSeconds":round(finished-START,3)})
  before=normalized(old);after=normalized(new);same=before==after
  record={'id':case['id'],'inputSha256':sha(source),'equalExceptVersionScriptShaAndOutputDirectory':same,'baselineNormalizedSha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),'candidateNormalizedSha256':hashlib.sha256(json.dumps(after,sort_keys=True).encode()).hexdigest()};status['defaultOff'].append(record)
  (OUT/f"default-off-{case['id']}.json").write_text(json.dumps({'record':record,'baseline':before,'candidate':after},indent=2)+'\n')
  assert same,'default-off source output changed: '+case['id']
 status['success']=len(status['defaultOff'])==4
except Exception as exc:status['error']=repr(exc);status['success']=False;raise
finally:
 status['elapsedSeconds']=round(time.monotonic()-START,3);status['peakParentRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024;status['peakChildrenRssBytes']=resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss*1024
 (OUT/'result.json').write_text(json.dumps(status,indent=2)+'\n');print(json.dumps(status),flush=True)
