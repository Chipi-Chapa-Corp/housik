`onest.woff2` is the complete Onest 2.001 variable font (weight axis 100–900),
converted from [Google Fonts' source TTF](https://github.com/google/fonts/blob/main/ofl/onest/Onest%5Bwght%5D.ttf)
with fontTools' WOFF2 encoder. License: [OFL.txt](OFL.txt).

Keep Latin, Czech and Cyrillic in one file: separate subsets combined with
`font-display: optional` can leave scripts using different fallback fonts and weights.
The app preloads this file and the service worker caches it for offline use.
