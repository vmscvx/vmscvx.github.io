$(document).ready(function () {
	$('.input').on('input', start);

	function escapeHtml(string) {
		return String(string).replace(/[&<>"']/g, function (s) {
			return ({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;'
			})[s];
		});
	}

	// Быстрое определение типа символа: 0 - другой, 1 - латиница, 2 - кириллица
	function getCharType(ch) {
		const code = ch.charCodeAt(0);
		// Латиница: A-Z (65–90), a-z (97–122)
		if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
			return 1;
		// Кириллица: А-Я (1040–1071), а-я (1072–1103), Ё (1025), ё (1105)
		if ((code >= 1040 && code <= 1103) || code === 1025 || code === 1105)
			return 2;
		return 0;
	}

	function start() {
		var istr = $('.input').val();
		var ostr = '';
		var cond = 0, condp = 0;
		for (let i = 0; i < istr.length; i++) {
			let ch = istr[i];
			condp = cond;
			cond = getCharType(ch);

			if (cond !== condp) {
				if (condp === 1 || condp === 2) ostr += '</span>';
				if (cond === 1) ostr += '<span class="lat">';
				else if (cond === 2) ostr += '<span class="cyr">';
			}
			ostr += escapeHtml(ch);
		}
		if (cond === 1 || cond === 2) ostr += '</span>';
		$('.output').html(ostr);
	}

	start();

	function syncScroll(el1, el2) {
		let $el1 = $(el1), $el2 = $(el2), forced = false;
		$el1.scroll(function () {
			if (forced) return forced = false;
			forced = true;
			$el2.scrollTop($el1.scrollTop());
			$el2.scrollLeft($el1.scrollLeft());
		});
		$el2.scroll(function () {
			if (forced) return forced = false;
			forced = true;
			$el1.scrollTop($el2.scrollTop());
			$el1.scrollLeft($el2.scrollLeft());
		});
	}
	syncScroll($('.input'), $('.output'));
});