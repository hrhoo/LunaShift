/** Luna, an original inline-vector moon rabbit inspired by the supplied sketch.
 * A UI component: no image service, external assets, or fonts required.
 */
export function lunaRabbit(kind='peek') {
 return `<svg class="luna-rabbit luna-rabbit-${kind}" viewBox="0 0 180 180" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
 <ellipse class="luna-shadow" cx="90" cy="166" rx="53" ry="7" fill="#25363c" opacity=".1"/>
 <g class="luna-character" stroke="#40505a" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
 <path d="M59 85C44 64 37 29 48 17C60 5 75 40 76 76" fill="#fbfcfa"/>
 <path d="M58 70C50 50 46 30 51 26C57 22 65 45 67 67" fill="#e1d8ee" stroke="none"/>
 <g class="luna-ear"><path d="M106 76C109 44 120 7 133 16C147 28 133 66 123 86" fill="#fbfcfa"/><path d="M116 67C119 43 126 25 131 27C137 31 127 58 122 70" fill="#e1d8ee" stroke="none"/></g>
 <path d="M54 116C44 130 42 152 55 163C73 175 116 175 129 161C140 145 128 123 119 115" fill="#f0f3f2"/>
 <path d="M61 143C60 128 114 123 119 143L119 164C102 173 72 172 61 164Z" fill="#e5eeeb" stroke="none"/>
 <path d="M45 103C43 78 61 65 88 65C116 63 140 77 138 101C137 124 116 136 92 136C67 136 46 124 45 103Z" fill="#fcfdfb"/>
 <path d="M91 75C83 74 79 83 85 88C89 91 94 90 97 86C91 87 86 82 91 75Z" fill="#c7b889" stroke="none"/>
 <g class="luna-eyes" stroke="none"><ellipse cx="71" cy="101" rx="4.1" ry="5.1" fill="#293b46"/><ellipse cx="111" cy="101" rx="4.1" ry="5.1" fill="#293b46"/><circle cx="72" cy="99.5" r="1.4" fill="white"/><circle cx="112" cy="99.5" r="1.4" fill="white"/></g>
 <ellipse cx="61" cy="111" rx="8" ry="4.5" fill="#efc9c8" opacity=".65" stroke="none"/><ellipse cx="121" cy="111" rx="8" ry="4.5" fill="#efc9c8" opacity=".65" stroke="none"/>
 <path d="M87 109Q91 106 95 109Q92 114 91 113Q89 113 87 109Z" fill="#b68b94" stroke="none"/>
 <path d="M91 113V116M91 116Q86 123 82 116M91 116Q96 123 100 116" stroke-width="1.7"/>
 <path d="M89 119L89 124L94 124L94 119" fill="white" stroke-width="1.3"/>
 <path d="M65 133Q91 144 116 132L114 142Q91 151 67 143Z" fill="#4f887b" stroke="none"/>
 <circle cx="92" cy="143" r="6" fill="#d9c58c" stroke="none"/><path d="M93 139C89 140 89 145 93 146C90 148 86 143 90 140Z" fill="#fff9df" stroke="none"/>
 <g class="luna-paws"><path d="M53 139C43 139 40 151 44 158C47 165 60 164 63 159C66 153 64 142 59 140" fill="#fcfdfb"/><path d="M122 140C115 143 116 155 119 160C124 165 137 162 139 155C141 147 133 136 127 139" fill="#fcfdfb"/><path d="M50 155v5m6-5v5m69-4v5m6-7v5" stroke="#b5c0c1" stroke-width="1.3"/></g>
 </g><g class="luna-sparkles" stroke="#baab7d" stroke-width="1.6"><path d="M149 53v10m-5-5h10M31 90v6m-3-3h6"/></g></svg>`;
}
