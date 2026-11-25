/** Typed facade for pdfmake's browser build, which registers bundled standard fonts. */
declare module 'pdfmake/build/pdfmake.js' {
  import type { TCreatedPdf, TDocumentDefinitions, TFontContainer } from 'pdfmake/interfaces';

  interface PdfMakeServer {
    addFontContainer(container: TFontContainer): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    createPdf(documentDefinitions: TDocumentDefinitions): TCreatedPdf;
  }

  const pdfmake: PdfMakeServer;
  export default pdfmake;
}
