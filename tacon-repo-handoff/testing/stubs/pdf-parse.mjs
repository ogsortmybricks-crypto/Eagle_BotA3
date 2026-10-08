// Stand-in for pdf-parse. The sandbox doesn't upload PDFs.
export class PDFParse {
  constructor() {}
  async getText() { throw new Error("PDF parsing isn't available in the Tac-On sandbox."); }
  async destroy() {}
}
export default PDFParse;
