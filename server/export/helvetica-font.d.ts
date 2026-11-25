/** Type bridge for pdfmake's bundled standard-font container (no runtime dependency added). */
declare module 'pdfmake/build/standard-fonts/Helvetica.js' {
  import type { TFontContainer } from 'pdfmake/interfaces';

  const container: TFontContainer;
  export default container;
}
