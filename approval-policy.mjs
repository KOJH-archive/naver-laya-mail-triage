export const AUTO_SEND_DELAY_MS=60_000;

export function autoSendDeadline(enabled,recipient,connected,now=Date.now()){
  return enabled && connected && /^[a-z0-9._%+-]+@gmail\.com$/.test(recipient || '')
    ? new Date(now+AUTO_SEND_DELAY_MS).toISOString()
    : null;
}

export function autoSendDue(approval,enabled,recipient,connected,now=Date.now()){
  return !!approval && !approval.sending && !!autoSendDeadline(enabled,recipient,connected,now)
    && Number.isFinite(Date.parse(approval.autoSendAt)) && Date.parse(approval.autoSendAt)<=now;
}
