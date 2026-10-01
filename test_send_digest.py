import unittest
from unittest.mock import MagicMock
from send_digest import send


class SendTests(unittest.TestCase):
    def test_smtp_uses_tls_and_sends_one_multipart_message(self):
        factory = MagicMock()
        client = factory.return_value.__enter__.return_value
        send({'account': 'test@naver.com', 'password': 'sample-only', 'recipient': 'results@gmail.com', 'subject': '[Laya분류결과] 1건', 'text': 'urgent', 'html': '<strong>urgent</strong>'}, smtp_factory=factory)
        factory.assert_called_once_with('smtp.naver.com', 587, timeout=30)
        client.starttls.assert_called_once()
        client.login.assert_called_once_with('test@naver.com', 'sample-only')
        client.send_message.assert_called_once()
        message = client.send_message.call_args.args[0]
        self.assertEqual(message['To'], 'results@gmail.com')
        self.assertEqual(len(message.get_payload()), 2)


if __name__ == '__main__':
    unittest.main()
