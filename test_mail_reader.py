import unittest
from mail_reader import parse_mail, read_inbox


class Inbox:
    def __init__(self, changed=False):
        self.calls = []
        self.changed = changed
        self.checks = 0

    def select(self, name, readonly=False):
        self.calls.append(('select', name, readonly))
        return 'OK', [b'1']

    def response(self, name):
        return name, [b'99']

    def uid(self, verb, *args):
        self.calls.append((verb, *args))
        if verb == 'SEARCH':
            return 'OK', [b'1']
        if args[1] == '(FLAGS)':
            self.checks += 1
            value = b'\\Seen' if self.changed and self.checks > 1 else b''
            return 'OK', [b'1 (UID 1 FLAGS (' + value + b'))']
        return 'OK', [(b'1 BODY[]', b'Subject: Test\r\nFrom: a@example.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello'), b')']


class ReadTests(unittest.TestCase):
    def test_only_readonly_peek_commands(self):
        client = Inbox()
        messages = read_inbox(client, {'account': 'test@naver.com'})
        self.assertEqual(client.calls[0], ('select', 'INBOX', True))
        self.assertIn(('FETCH', b'1', '(BODY.PEEK[])'), client.calls)
        self.assertTrue(messages[0]['readStateVerified'])
        self.assertFalse(messages[0]['seen'])

    def test_state_change_stops_collection(self):
        with self.assertRaises(RuntimeError):
            read_inbox(Inbox(changed=True), {'account': 'test@naver.com'})

    def test_already_processed_mail_is_not_fetched(self):
        config = {'account': 'test@naver.com'}
        first = read_inbox(Inbox(), config)
        client = Inbox()
        self.assertEqual(read_inbox(client, {**config, 'known': [first[0]['id']]}), [])
        self.assertFalse(any(c[0] == 'FETCH' for c in client.calls))

    def test_html_and_attachments(self):
        raw = b'Subject: =?utf-8?b?7JeF66y0?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<p>hello</p><script>hidden</script>\r\n--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\nsecret attachment\r\n--x--'
        result = parse_mail(raw)
        self.assertEqual(result['subject'], '업무')
        self.assertEqual(result['body'], 'hello')


if __name__ == '__main__':
    unittest.main()
