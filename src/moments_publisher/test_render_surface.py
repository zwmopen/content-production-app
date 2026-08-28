import unittest

from moments_publisher.wechat_render_surface import (
    MEDIA_GRID_LEFT,
    MEDIA_GRID_STEP_X,
    MEDIA_GRID_STEP_Y,
    MEDIA_GRID_TILE_H,
    MEDIA_GRID_TILE_W,
    MEDIA_GRID_TOP,
    RenderSurfaceError,
    detect_composer_text_visual,
    detect_media_grid_count,
    _paste_and_verify_text,
)


class _FakeClipboard:
    def __init__(self) -> None:
        self.value = ""

    def copy(self, value: str) -> None:
        self.value = value

    def paste(self) -> str:
        return self.value


class _FakePyAutoGui:
    def __init__(self, clipboard: _FakeClipboard, accepted_on_attempt: int | None) -> None:
        self.clipboard = clipboard
        self.accepted_on_attempt = accepted_on_attempt
        self.attempt = 0
        self.actions: list[tuple[str, tuple[str, ...]]] = []

    def click(self, x: int, y: int) -> None:
        self.actions.append(("click", (str(x), str(y))))

    def hotkey(self, *keys: str) -> None:
        self.actions.append(("hotkey", tuple(keys)))
        if keys == ("ctrl", "v"):
            self.attempt += 1
        elif keys == ("ctrl", "c"):
            if self.accepted_on_attempt == self.attempt:
                self.clipboard.value = "原始文案"
            else:
                self.clipboard.value = ""


class RenderSurfaceTextTests(unittest.TestCase):
    def test_focus_recovery_is_bounded_and_accepts_same_work_item(self) -> None:
        clipboard = _FakeClipboard()
        pyautogui = _FakePyAutoGui(clipboard, accepted_on_attempt=2)
        _paste_and_verify_text(
            "原始文案",
            (0, 0, 1000, 1000),
            pyautogui=pyautogui,
            pyperclip=clipboard,
            settle_seconds=0.01,
        )
        self.assertEqual(pyautogui.attempt, 2)
        self.assertEqual(sum(action == "click" for action, _ in pyautogui.actions), 2)

    def test_text_mismatch_stops_after_bounded_attempts(self) -> None:
        clipboard = _FakeClipboard()
        pyautogui = _FakePyAutoGui(clipboard, accepted_on_attempt=None)
        with self.assertRaisesRegex(RenderSurfaceError, "已完成 2 次"):
            _paste_and_verify_text(
                "原始文案",
                (0, 0, 1000, 1000),
                pyautogui=pyautogui,
                pyperclip=clipboard,
                settle_seconds=0.01,
            )
        self.assertEqual(pyautogui.attempt, 2)


class RenderSurfaceVisualTests(unittest.TestCase):
    @staticmethod
    def _fake_grid(count: int, *, top: float = MEDIA_GRID_TOP):
        from PIL import Image

        width, height = 682, 851
        image = Image.new("RGB", (width, height), (30, 30, 30))
        for index in range(count):
            row, column = divmod(index, 3)
            x = round((MEDIA_GRID_LEFT + column * MEDIA_GRID_STEP_X) * width)
            y = round((top + row * MEDIA_GRID_STEP_Y) * height)
            tile_width = round(MEDIA_GRID_TILE_W * width)
            tile_height = round(MEDIA_GRID_TILE_H * height)
            for sample_y in range(y + 8, min(height, y + tile_height - 8), 4):
                for sample_x in range(x + 8, min(width, x + tile_width - 8), 4):
                    image.putpixel(
                        (sample_x, sample_y),
                        ((sample_x * 3) % 255, (sample_y * 5) % 255, (sample_x + sample_y) % 255),
                    )
        return image

    def test_variable_height_grid_and_visual_text_gate(self) -> None:
        image_without_text = self._fake_grid(7)
        image_with_text = image_without_text.copy()
        for y in range(31, 220, 2):
            for x in range(55, 550, 2):
                image_with_text.putpixel((x, y), (230, 230, 230))
        rect = (0, 0, 682, 851)
        self.assertEqual(
            detect_media_grid_count(rect, screenshot=lambda **_kwargs: image_without_text),
            7,
        )
        self.assertEqual(
            detect_media_grid_count(rect, screenshot=lambda **_kwargs: image_with_text),
            7,
        )
        self.assertFalse(
            detect_composer_text_visual(
                rect,
                baseline_image=image_without_text,
                screenshot=lambda **_kwargs: image_without_text,
            )
        )
        self.assertTrue(
            detect_composer_text_visual(
                rect,
                baseline_image=image_without_text,
                screenshot=lambda **_kwargs: image_with_text,
            )
        )


if __name__ == "__main__":
    unittest.main()
