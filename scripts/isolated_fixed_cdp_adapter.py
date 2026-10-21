"""Compatibility entry; implementation belongs to teambuilding-production-3modes."""
import importlib.util
import os
from pathlib import Path
import runpy
import sys


def canonical_script():
    override = os.environ.get('TEAMBUILDING_3MODES_SKILL_ROOT')
    if override:
        root = Path(override).expanduser().resolve()
    else:
        root = next((parent / '.agents' / 'skills' / 'teambuilding-production-3modes'
                     for parent in Path(__file__).resolve().parents
                     if (parent / '.agents' / 'skills' / 'teambuilding-production-3modes').is_dir()), None)
    target = root / 'scripts' / 'isolated_fixed_cdp_adapter.py' if root else None
    if target is None or not target.is_file() or target.resolve() == Path(__file__).resolve():
        raise RuntimeError('Canonical teambuilding-production-3modes skill missing; set TEAMBUILDING_3MODES_SKILL_ROOT')
    return target


if __name__ == '__main__':
    runpy.run_path(str(canonical_script()), run_name='__main__')
else:
    spec = importlib.util.spec_from_file_location(__name__, canonical_script())
    module = importlib.util.module_from_spec(spec)
    sys.modules[__name__] = module
    spec.loader.exec_module(module)
