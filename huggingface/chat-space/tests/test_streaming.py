import unittest

from stream_utils import generation_finish_reason


class GenerationFinishReasonTests(unittest.TestCase):
    def test_token_limit_without_eos_is_length(self):
        self.assertEqual(generation_finish_reason(2048, 2048, 42, 2), "length")

    def test_eos_at_token_limit_is_stop(self):
        self.assertEqual(generation_finish_reason(2048, 2048, 2, 2), "stop")

    def test_generation_below_token_limit_is_stop(self):
        self.assertEqual(generation_finish_reason(180, 2048, 2, 2), "stop")


if __name__ == "__main__":
    unittest.main()
