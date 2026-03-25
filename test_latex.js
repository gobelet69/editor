const latexjs = require('latex.js')
try {
  let doc = latexjs.parse("\\begin{document}\nHello\n\\end{document}");
  console.log("Success 1");
} catch (e) {
  console.log("Error 1:", e.message);
}
try {
  let doc = latexjs.parse("\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}");
  console.log("Success 2");
} catch (e) {
  console.log("Error 2:", e.message);
}
