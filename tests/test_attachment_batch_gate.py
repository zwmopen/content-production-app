import os
import sys
import unittest

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from attachment_batch_gate import is_complete_attachment_batch


class AttachmentBatchGateTests(unittest.TestCase):
    def test_accepts_exact_complete_batch(self):
        self.assertTrue(is_complete_attachment_batch(3, 3))
        self.assertTrue(is_complete_attachment_batch(10, 10))

    def test_rejects_partial_batch_that_old_percentage_gate_allowed(self):
        self.assertFalse(is_complete_attachment_batch(1, 3))
        self.assertFalse(is_complete_attachment_batch(1, 10))

    def test_rejects_empty_or_overfull_batch(self):
        self.assertFalse(is_complete_attachment_batch(0, 3))
        self.assertFalse(is_complete_attachment_batch(4, 3))
        self.assertFalse(is_complete_attachment_batch(0, 0))

    def test_rejects_non_integer_counts(self):
        self.assertFalse(is_complete_attachment_batch("3", 3))
        self.assertFalse(is_complete_attachment_batch(True, 1))


if __name__ == "__main__":
    unittest.main()
