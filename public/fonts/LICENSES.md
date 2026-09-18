# Font licenses

Self-hosted webfonts served from `/fonts/`. Declarations live in `src/fonts.css`.
Downloaded and checked on 2026-09-16. Total of the six WOFF2 files: 207,848 bytes (203 KiB).

## Switzer

- Family: Switzer (Indian Type Foundry), files `Switzer-Variable.woff2` and `Switzer-VariableItalic.woff2`
- Version: 1.200 (font `name` table). Variable, `wght` 100 to 900.
- Source: https://api.fontshare.com/v2/fonts/download/switzer (Fontshare download endpoint; font page https://www.fontshare.com/fonts/switzer). The files here are the zip's `Fonts/WEB/fonts/Switzer-Variable.woff2` and `Switzer-VariableItalic.woff2`, byte for byte.
- License: ITF Free Font License (FFL) Version 2.0, 17 Aug 2026 (`License/FFL.txt` in the zip). Not open source; a free EULA.
- Self-hosting: permitted. Section 01, Grant of License:

  > You are hereby granted a non-exclusive, non-assignable, non-transferable and terminable license to access, download, install, store and use the Font Software for personal or commercial purposes, free of charge and for an unlimited period of time, subject to the terms of this License.

  > You may self-host the Font Software on your own servers or infrastructure for use on your own websites and applications, including through standard webfont technologies such as CSS @font-face. Self-hosting by end users is permitted and recommended for greater control, reliability and performance. Use of the Fontshare API is optional and is not required for web use.

- Subsetting: NOT permitted, which is why these two files are unmodified. Section 02, Limitations of Usage:

  > You may not modify, edit, adapt, translate, reverse engineer, decompile, disassemble or otherwise alter the Font Software or the typeface designs embodied therein, in whole or in part, without the prior written consent of the Licensor. This includes modifying or replacing glyphs, subsetting, format conversion, or altering font names, copyright information, ownership information or other metadata.

- Redistribution: Section 02 also says the Font Software may not be "distributed ... through another font website, font library, marketplace, repository, download service ... publicly accessible servers", then adds: "nothing in this Section 02 restricts the self-hosting, embedding or other use of the Font Software by the Licensee for the Licensee's own websites". Serving from this site is covered. Keeping the files in a public source repository is not addressed either way; if that matters, keep them out of git and fetch them at build time.
- Sizes: `Switzer-Variable.woff2` 43,220 bytes (source TTF 141,020); `Switzer-VariableItalic.woff2` 33,408 bytes (source TTF 85,128). Official WOFF2 as shipped, no subsetting.

## Instrument Serif

- Family: Instrument Serif, designed by Rodrigo Fuenzalida and Jordan Egstad. Files `InstrumentSerif-Regular.woff2` and `InstrumentSerif-Italic.woff2`. Static weight 400.
- Version: 1.000 (font `name` table; built with ttfautohint and gftools 0.9.27).
- Source: https://github.com/google/fonts/tree/main/ofl/instrumentserif (`InstrumentSerif-Regular.ttf`, `InstrumentSerif-Italic.ttf`, `OFL.txt`), which pins upstream https://github.com/Instrument/instrument-serif at commit 65c0ef225f386a3c7e87570a4aa9cc0262c2fd81.
- Copyright: Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)
- License: SIL Open Font License, Version 1.1. No Reserved Font Name is declared in the OFL.txt header, so the subset files keep the family name.
- Self-hosting and subsetting: permitted. OFL 1.1, Permission & Conditions:

  > Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions:

  Condition 2 asks that each copy "contains the above copyright notice and this license"; the subset files keep name records 0 (copyright), 13 (license text) and 14 (license URL).
- Processing: pyftsubset (fontTools 4.65.0), Latin + Latin-1 + Latin Extended-A + General Punctuation + symbols unicode range, all layout features kept, hinting dropped, WOFF2.
- Sizes: `InstrumentSerif-Regular.woff2` 15,540 bytes (from 70,012 TTF); `InstrumentSerif-Italic.woff2` 16,020 bytes (from 71,592 TTF). 238 glyphs each.

## JetBrains Mono

- Family: JetBrains Mono. Files `JetBrainsMono-Variable.woff2` and `JetBrainsMono-VariableItalic.woff2`. Variable, `wght` 100 to 800.
- Version: 2.304 (GitHub release v2.304, published 2023-01-14).
- Source: https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip, files `fonts/variable/JetBrainsMono[wght].ttf` and `JetBrainsMono-Italic[wght].ttf`, plus `OFL.txt`.
- Copyright: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- License: SIL Open Font License, Version 1.1. No Reserved Font Name is declared in the OFL.txt header, so the subset files keep the family name.
- Self-hosting and subsetting: permitted, same OFL clause as above:

  > Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions:

  Name records 0, 13 and 14 are kept in the subset files.
- Processing: same pyftsubset settings as Instrument Serif; the `wght` axis is kept, not instanced.
- Sizes: `JetBrainsMono-Variable.woff2` 48,192 bytes (from 303,144 TTF, 532 glyphs); `JetBrainsMono-VariableItalic.woff2` 51,468 bytes (from 308,888 TTF, 498 glyphs). The italic is declared in `fonts.css` but a browser only fetches it when italic monospace text is on the page.
