type PlayerIdentity = {
  pId?: string | null;
  name?: string | null;
  runtimeName?: string | null;
};

export function isTwentyTwoSevenPid(pId?: string | null) {
  const normalized = String(pId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === '227' || normalized === '22nanabun' || normalized === 'nananiji';
}

export function isTwentyTwoSevenPlayer(player: PlayerIdentity) {
  return isTwentyTwoSevenPid(player.pId);
}
