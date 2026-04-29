// Minimal mock of next/server for Vitest (no Next.js runtime needed)

export class NextRequest extends Request {
  public readonly nextUrl: URL

  constructor(input: string | URL | Request, init?: RequestInit) {
    super(input, init)
    this.nextUrl = new URL(
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString(),
    )
  }
}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const json = JSON.stringify(body)
    const headers = new Headers(init?.headers)
    headers.set('content-type', 'application/json')
    return new NextResponse(json, { ...init, headers })
  }

  async json(): Promise<unknown> {
    const text = await this.text()
    return JSON.parse(text)
  }
}
