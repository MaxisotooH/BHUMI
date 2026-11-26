// Sustituye a los módulos de Node (fs, path, os) que el servidor solo usa cuando corre con Node, nunca en el navegador.
const vacio = {};
export default vacio;
