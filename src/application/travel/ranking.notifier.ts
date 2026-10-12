/**
 * 이동 기록이 저장되어 랭킹이 바뀔 때 알리는 포트. 구현(WebSocket)은 infra에 있고
 * 이 계층은 어떤 방식으로 전달되는지 모른다
 */
export abstract class RankingNotifier {
  /** 점수를 얻은 본인에게 내 월간 누적 점수를 알린다 */
  abstract sendScoreUpdate(
    userId: string,
    payload: { periodKey: string; currentPoints: number },
  ): void;

  /** 로그인한 모든 사용자에게 랭킹이 바뀌었다는 익명 신호를 보낸다 */
  abstract broadcastChanged(payload: {
    periodType: 'MONTHLY' | 'ALL';
    periodKey: string;
  }): void;
}
