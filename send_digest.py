"""Send one explicitly approved digest via Naver SMTP."""
import json
import smtplib
import ssl
import sys
from email.message import EmailMessage


def send(data, smtp_factory=smtplib.SMTP):
    message = EmailMessage()
    message['From'] = data['account']
    message['To'] = data['recipient']
    message['Subject'] = data['subject']
    message.set_content(data['text'])
    message.add_alternative(data['html'], subtype='html')
    with smtp_factory('smtp.naver.com', 587, timeout=30) as client:
        client.ehlo()
        client.starttls(context=ssl.create_default_context())
        client.ehlo()
        client.login(data['account'], data['password'])
        client.send_message(message)


def main():
    try:
        send(json.load(sys.stdin))
        print(json.dumps({'sent': True}))
        return 0
    except smtplib.SMTPAuthenticationError:
        text = '네이버 SMTP 인증에 실패했습니다. 앱 비밀번호를 확인해주세요.'
    except Exception:
        text = '메일 발송 결과를 확인할 수 없습니다. Gmail 수신함을 확인한 뒤 다시 시도해주세요.'
    print(json.dumps({'error': text}, ensure_ascii=False))
    return 1


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
