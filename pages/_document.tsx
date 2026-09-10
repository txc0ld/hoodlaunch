import Document, { DocumentContext, Html, Head, Main, NextScript } from 'next/document';
export default class HoodDocument extends Document<{ nonce: string }> {
  static async getInitialProps(ctx: DocumentContext) { const props = await Document.getInitialProps(ctx); const nonce = ctx.req?.headers['x-nonce']; return { ...props, nonce: typeof nonce === 'string' ? nonce : '' }; }
  render() { return <Html lang="en"><Head nonce={this.props.nonce} /><body><Main /><NextScript nonce={this.props.nonce} /></body></Html>; }
}
