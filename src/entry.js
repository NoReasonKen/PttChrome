// Load the shared palette before component styles. Keep main/color after Mantine
// so equal-specificity rules preserve the terminal's row rendering contract.
import './css/mobile_chrome_palette.css';
import './css/mantine.css';
import './css/main.css';
import './css/color.css';
import 'photoswipe/style.css';
import './css/image_viewer.css';
import './js/main';
