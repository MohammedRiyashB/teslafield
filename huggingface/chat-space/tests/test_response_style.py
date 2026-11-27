import unittest

from response_style import apply_response_style, normalize_response_style


class ResponseStyleTests(unittest.TestCase):
    def test_supported_styles_are_preserved(self):
        for style in ("concise", "balanced", "detailed"):
            with self.subTest(style=style):
                self.assertEqual(normalize_response_style(style), style)

    def test_unknown_or_non_string_style_defaults_to_balanced(self):
        for style in ("", "fast", None, 7, ["detailed"]):
            with self.subTest(style=style):
                self.assertEqual(normalize_response_style(style), "balanced")

    def test_style_instruction_is_added_to_system_prompt(self):
        original = [{"role": "system", "content": "Base instructions"}, {"role": "user", "content": "Hello"}]
        updated = apply_response_style(original, "concise")
        self.assertEqual(updated[0]["role"], "system")
        self.assertIn("RESPONSE STYLE: Be concise and direct.", updated[0]["content"])
        self.assertEqual(updated[1], original[1])

    def test_original_messages_are_not_mutated(self):
        original = [{"role": "system", "content": "Base instructions"}]
        apply_response_style(original, "detailed")
        self.assertEqual(original, [{"role": "system", "content": "Base instructions"}])

    def test_missing_system_message_is_added(self):
        updated = apply_response_style([{"role": "user", "content": "Hello"}], "balanced")
        self.assertEqual(updated[0]["role"], "system")
        self.assertIn("RESPONSE STYLE:", updated[0]["content"])
        self.assertEqual(updated[1]["role"], "user")


if __name__ == "__main__":
    unittest.main()
