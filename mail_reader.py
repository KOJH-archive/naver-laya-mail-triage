"""Read Naver INBOX using EXAMINE and BODY.PEEK; credentials arrive on stdin."""
import email
import hashlib
import html.parser
import imaplib
import json
import re
import ssl
import sys
from email import policy


class TextParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag in ('br', 'p', 'div', 'tr') and not self.hidden:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1

    def handle_data(self, text):
        if not self.hidden:
            self.parts.append(text)


def parse_mail(raw):
    message = email.message_from_bytes(raw, policy=policy.default)
    part = message.get_body(preferencelist=('plain', 'html'))
    text = ''
    if part:
        text = part.get_content()
        if part.get_content_type() == 'text/html':
            parser = TextParser()
            parser.feed(text)
            text = ''.join(parser.parts)
    return {
        'subject': str(message.get('Subject', '(제목 없음)')),
        'sender': str(message.get('From', '(발신자 없음)')),
        'receivedAt': str(message.get('Date', '')) or None,
        'body': text.strip(),
    }


def flags(client, uid):
    status, rows = client.uid('FETCH', uid, '(FLAGS)')
    if status != 'OK':
        raise RuntimeError('읽음 상태를 확인할 수 없습니다.')
    values = [r[0] if isinstance(r, tuple) else r for r in rows if r]
    for value in values:
        match = re.search(rb'FLAGS \(([^)]*)\)', value)
        if match:
            return b'\\Seen' in match.group(1).split()
    raise RuntimeError('메일 상태가 없거나 메일이 삭제되었습니다.')


def read_inbox(client, config, report=lambda **event: None):
    report(stage='listing')
    status, _ = client.select('INBOX', readonly=True)
    if status != 'OK':
        raise RuntimeError('받은메일함을 읽기 전용으로 열 수 없습니다.')
    if config.get('action') == 'connect':
        return []
    _, validity = client.response('UIDVALIDITY')
    if not validity or not validity[0]:
        raise RuntimeError('메일함 식별 정보를 확인할 수 없습니다.')
    generation = validity[0].decode('ascii')
    status, rows = client.uid('SEARCH', None, 'UNSEEN' if config.get('unreadOnly') else 'ALL')
    if status != 'OK':
        raise RuntimeError('메일 목록을 가져올 수 없습니다.')
    account = hashlib.sha256(config['account'].lower().encode()).hexdigest()[:24]
    known = set(config.get('known', []))
    limit = min(50, max(1, int(config.get('limit', 10))))
    messages = []
    pending = []
    for uid in reversed(rows[0].split() if rows and rows[0] else []):
        identity = f'imap:{account}:INBOX:{generation}:{uid.decode()}'
        if identity in known:
            continue
        pending.append((uid, identity))
        if len(pending) >= limit:
            break
    report(stage='collecting', total=len(pending), collected=0)
    for uid, identity in pending:
        before = flags(client, uid)
        status, rows = client.uid('FETCH', uid, '(BODY.PEEK[])')
        if status != 'OK':
            raise RuntimeError('메일 본문을 가져올 수 없습니다.')
        raw = next((r[1] for r in rows if isinstance(r, tuple)), None)
        if raw is None:
            raise RuntimeError('메일 본문이 없습니다.')
        after = flags(client, uid)
        if before != after:
            raise RuntimeError('수집 도중 읽음 상태가 변경되어 중단했습니다. 다른 메일 앱의 동작도 확인해주세요.')
        messages.append({'id': identity, 'seen': after, 'readStateVerified': True, **parse_mail(raw)})
        report(stage='collecting', total=len(pending), collected=len(messages))
        if len(messages) >= limit:
            break
    return messages


def main():
    client = None
    try:
        config = json.load(sys.stdin)
        def report(**event):
            print(json.dumps(event), file=sys.stderr, flush=True)
        report(stage='connecting')
        client = imaplib.IMAP4_SSL('imap.naver.com', 993, ssl_context=ssl.create_default_context(), timeout=30)
        client.login(config['account'], config['password'])
        print(json.dumps({'messages': read_inbox(client, config, report)}, ensure_ascii=False))
    except imaplib.IMAP4.error:
        print(json.dumps({'error': 'IMAP 연결 또는 인증 실패. IMAP 사용 설정과 앱 비밀번호를 확인해주세요.'}, ensure_ascii=False))
        return 1
    except Exception as error:
        text = str(error) if isinstance(error, RuntimeError) else '메일 연결에 실패했습니다. 네트워크와 IMAP 설정을 확인해주세요.'
        print(json.dumps({'error': text}, ensure_ascii=False))
        return 1
    finally:
        if client:
            try:
                client.logout()
            except Exception:
                pass
    return 0


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
