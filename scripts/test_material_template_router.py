import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import material_template_router as router


class MaterialTemplateRouterTests(unittest.TestCase):
    def test_precise_team_building_metadata_outranks_incidental_game_tag(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "HR团建策划"
            source.mkdir()
            (source / ".tags.json").write_text(json.dumps({
                "tagging": {
                    "trafficType": "精准团建",
                    "mainTag": "团建方案",
                    "tags": ["企业徒步团建", "团建游戏", "趣味运动会"],
                }
            }, ensure_ascii=False), encoding="utf-8")

            self.assertEqual(router.detect_material_category(source), "team_building")

    def test_explicit_game_library_path_still_routes_to_game(self):
        source = Path(tempfile.gettempdir()) / "团建游戏" / "破冰游戏"
        self.assertEqual(router.detect_material_category(source), "game")


if __name__ == "__main__":
    unittest.main()
