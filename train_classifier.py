"""Train and evaluate a local classifier from human-reviewed mail."""
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / 'data' / 'results.json'
MODEL = ROOT / 'data' / 'review-classifier.joblib'
REPORT = ROOT / 'data' / 'review-classifier-report.json'
PUBLIC_MODEL = ROOT / 'seed' / 'public-classifier.joblib'
PUBLIC_REPORT = ROOT / 'seed' / 'public-report.json'
THRESHOLD = 0.35


def sender_key(value):
    match = re.search(r'[\w.%+-]+@[\w.-]+', value or '')
    return match.group().lower() if match else str(value).lower()


def features(row):
    subject = re.sub(r'\d+', '#', row.get('subject') or '')
    body = re.sub(r'\d+', '#', row.get('body') or '')[:1200]
    return f'{subject} {subject} {subject} {body}'


def model():
    return make_pipeline(TfidfVectorizer(analyzer='char', ngram_range=(2, 4), sublinear_tf=True, max_features=30000), LogisticRegression(max_iter=400, class_weight='balanced'))


def train():
    rows = json.loads(RESULTS.read_text(encoding='utf-8'))
    reviewed = [r for r in rows if r.get('reviewed') and r.get('category') and r.get('subject') and r.get('body')]
    if len(reviewed) < 12 or len({r['category'] for r in reviewed}) < 2:
        raise ValueError('학습하려면 서로 다른 분류를 포함한 검토 메일 12개 이상이 필요합니다.')
    x = [features(r) for r in reviewed]
    y = [r['category'] for r in reviewed]
    groups = [sender_key(r.get('sender')) for r in reviewed]
    baseline = [r.get('modelPrediction', {}).get('category') or r.get('raw', {}).get('answers', {}).get('category', {}).get('choice') for r in reviewed]
    evaluated = []
    for train_idx, test_idx in LeaveOneGroupOut().split(x, y, groups):
        if len(set(y[i] for i in train_idx)) < 2:
            continue
        candidate = model().fit([x[i] for i in train_idx], [y[i] for i in train_idx])
        probabilities = candidate.predict_proba([x[i] for i in test_idx])
        classes = candidate[-1].classes_
        for i, probs in zip(test_idx, probabilities):
            best = int(probs.argmax())
            suggestion = str(classes[best])
            confidence = float(probs[best])
            support = Counter(y[j] for j in train_idx)[suggestion]
            applied = confidence >= THRESHOLD and support >= 3
            evaluated.append({'truth': y[i], 'base': baseline[i], 'proposal': suggestion, 'confidence': confidence, 'support': support, 'applied': applied})
    if not evaluated:
        raise ValueError('발신자별 평가를 진행할 수 없습니다.')
    base_correct = sum(r['base'] == r['truth'] for r in evaluated)
    proposal_correct = sum(r['proposal'] == r['truth'] for r in evaluated)
    blended_correct = sum((r['proposal'] if r['applied'] else r['base']) == r['truth'] for r in evaluated)
    applied_count = sum(r['applied'] for r in evaluated)
    enabled = applied_count >= 3 and blended_correct > base_correct
    final = model().fit(x, y)
    temporary = MODEL.with_suffix('.tmp')
    joblib.dump(final, temporary)
    os.replace(temporary, MODEL)
    report = {'reviewed': len(reviewed), 'senderGroups': len(set(groups)), 'evaluated': len(evaluated), 'baseCorrect': base_correct, 'proposalCorrect': proposal_correct, 'blendedCorrect': blended_correct, 'appliedInEvaluation': applied_count, 'threshold': THRESHOLD, 'enabled': enabled, 'categoryCounts': dict(Counter(y))}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


def predict():
    data = json.load(sys.stdin)
    batched = isinstance(data, list)
    rows = data if batched else [data]
    report_file = REPORT if REPORT.exists() and MODEL.exists() else PUBLIC_REPORT
    model_file = MODEL if report_file == REPORT else PUBLIC_MODEL
    report = json.loads(report_file.read_text(encoding='utf-8'))
    if not report['enabled']:
        print(json.dumps([{'enabled': False} for _ in rows] if batched else {'enabled': False}))
        return
    classifier = joblib.load(model_file)
    results = []
    for values in classifier.predict_proba([features(row) for row in rows]):
        best = int(values.argmax())
        category = str(classifier[-1].classes_[best])
        confidence = float(values[best])
        support = report['categoryCounts'].get(category, 0)
        results.append({'enabled': True, 'category': category, 'confidence': confidence, 'apply': confidence >= THRESHOLD and support >= 3})
    print(json.dumps(results if batched else results[0], ensure_ascii=False))


if __name__ == '__main__':
    try:
        result = train() if len(sys.argv) > 1 and sys.argv[1] == 'train' else predict()
        if result is not None:
            print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
