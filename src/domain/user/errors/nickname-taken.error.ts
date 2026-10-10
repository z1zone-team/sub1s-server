export class NicknameTakenError extends Error {
  constructor(public readonly nickname: string) {
    super(`nickname already taken: ${nickname}`);
    this.name = 'NicknameTakenError';
  }
}
