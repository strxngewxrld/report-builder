// fontkit (font parsing and subsetting for the PDF export) as a separate script: it is large and only needed when a
// PDF is exported, so the designer loads it on demand (see loadFontkit in render/pdf.ts).
import fontkit from '@pdf-lib/fontkit';

(window as unknown as { bcReportBuilderFontkit: typeof fontkit }).bcReportBuilderFontkit = fontkit;
