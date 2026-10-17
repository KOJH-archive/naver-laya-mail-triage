const payment=/(?:결제\s*(?:완료|승인|취소|실패|내역|영수증)|(?:주문|구매)\s*(?:완료|확인|접수|취소|내역|번호)|(?:배송|택배)\s*(?:시작|출발|중|완료|도착|조회|안내)|영수증|청구서|환불\s*(?:완료|처리|안내)|payment\s*(?:completed|confirmed|failed)|order\s*(?:confirmed|shipped|delivered)|invoice|receipt)/i;
const adTag=/(?:\[광고\]|\(광고\))/i;
const promotion=/(?:할인|쿠폰|특가|세일|프로모션|이벤트|뉴스레터|(?:sale|discount|coupon|promotion|newsletter)\b)/i;
const notice=/(?:로그인|로그아웃|회원\s*가입|가입|인증|비밀번호|보안|계정|서비스|약관|정책).{0,16}(?:알림|안내|완료|확인|변경|코드|환영)|(?:알림|안내).{0,16}(?:로그인|가입|인증|비밀번호|보안|계정)|(?:verification|login|sign[ -]?up|password|security)\s*(?:code|notice|alert|notification)|welcome\s+to/i;

export function categorySignal(mail){
  const subject=String(mail.subject || '');
  const isPayment=payment.test(subject);
  const tagged=adTag.test(subject);
  const hasOffer=promotion.test(subject);
  const isPromotion=tagged || hasOffer;
  const isNotice=notice.test(subject);
  if(isPayment && !isPromotion)return {category:'결제·배송',reason:'payment'};
  if(isPromotion && !isPayment)return {category:'광고',reason:tagged?'ad-tag':'offer'};
  if(isNotice && !isPayment && !isPromotion)return {category:'안내',reason:'notice'};
  return null;
}

export function classifyByPolicy(mail){return categorySignal(mail)?.category || null;}
