"""Compatibility collection; test cases are maintained in the shared skill."""
import importlib.util
from pathlib import Path
import unittest
from isolated_fixed_cdp_adapter import __file__ as implementation_file

spec = importlib.util.spec_from_file_location('_canonical_adapter_tests',
    Path(implementation_file).with_name('test_isolated_fixed_cdp_adapter.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
AdapterTests = module.AdapterTests

if __name__ == '__main__':
    unittest.main()
