declare module "@kobalab/majiang-core" {
  const Majiang: {
    Shoupai: {
      new (tiles?: string[]): {
        zimo(tile: string): void;
        toString(): string;
      };
      fromString(value: string): {
        zimo(tile: string): void;
        toString(): string;
      };
    };
    Util: {
      hule(
        shoupai: unknown,
        rongpai?: string | null,
        param?: Record<string, unknown>
      ): {
        hupai?: { name: string; fanshu: number }[];
        fu?: number;
        fanshu?: number;
        defen?: number;
        fenpei?: number[];
      };
      hule_param(param?: Record<string, unknown>): Record<string, unknown>;
      xiangting(shoupai: unknown): number;
    };
    rule(): Record<string, unknown>;
  };

  export default Majiang;
}
