<?php
/**
 * Contact-form wiring (Phase 2, Chunk 3).
 *
 * FreshPress renders a contact form marked with data-fp-form="contact" (name /
 * email / message fields) but with no action — the app doesn't know which channel
 * it's serving. During sync we point that form at the site's public contact
 * endpoint (from the manifest) and inject a tiny, dependency-free progressive
 * enhancement script that submits it over fetch() so the visitor stays on the page
 * instead of landing on a JSON response. Non-contact forms are never touched.
 *
 * wire_contact_forms() is pure (HTML + endpoint in, HTML out) so it's reviewable
 * and testable without WordPress.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Forms {

	const MARKER        = 'data-fp-form="contact"';
	const SIGNUP_MARKER = 'data-fp-form="signup"';

	/**
	 * Point every contact form in $html at $endpoint and attach the submit handler.
	 * Returns $html unchanged when there's no endpoint or no contact form.
	 *
	 * @param string $html
	 * @param string $endpoint Public contact endpoint from the manifest.
	 * @return string
	 */
	public static function wire_contact_forms( $html, $endpoint ) {
		if ( '' === $html || '' === (string) $endpoint || false === strpos( $html, self::MARKER ) ) {
			return $html;
		}

		$esc_action   = esc_url( $endpoint );
		$esc_endpoint = esc_attr( $endpoint );

		$html = preg_replace_callback(
			'#<form\b([^>]*\bdata-fp-form=(["\'])contact\2[^>]*)>#i',
			function ( $m ) use ( $esc_action, $esc_endpoint ) {
				// Drop any existing action/method, then set ours + the endpoint the handler reads.
				$attrs = preg_replace( '#\s(?:action|method|data-fp-endpoint)=(["\']).*?\1#i', '', $m[1] );
				return '<form' . $attrs . ' method="post" action="' . $esc_action . '" data-fp-endpoint="' . $esc_endpoint . '">';
			},
			$html
		);

		// Attach the handler once per page.
		if ( false === strpos( $html, 'data-fp-contact-handler' ) ) {
			$html .= self::handler_script();
		}

		return $html;
	}

	/**
	 * Point every signup form (data-fp-form="signup") in $html at $endpoint and
	 * attach the signup submit handler. Same pure shape as wire_contact_forms().
	 *
	 * @param string $html
	 * @param string $endpoint Public signup endpoint from the manifest.
	 * @return string
	 */
	public static function wire_signup_forms( $html, $endpoint ) {
		if ( '' === $html || '' === (string) $endpoint || false === strpos( $html, self::SIGNUP_MARKER ) ) {
			return $html;
		}

		$esc_action   = esc_url( $endpoint );
		$esc_endpoint = esc_attr( $endpoint );

		$html = preg_replace_callback(
			'#<form\b([^>]*\bdata-fp-form=(["\'])signup\2[^>]*)>#i',
			function ( $m ) use ( $esc_action, $esc_endpoint ) {
				$attrs = preg_replace( '#\s(?:action|method|data-fp-endpoint)=(["\']).*?\1#i', '', $m[1] );
				return '<form' . $attrs . ' method="post" action="' . $esc_action . '" data-fp-endpoint="' . $esc_endpoint . '">';
			},
			$html
		);

		if ( false === strpos( $html, 'data-fp-signup-handler' ) ) {
			$html .= self::signup_handler_script();
		}

		return $html;
	}

	/**
	 * Dependency-free progressive-enhancement handler. Submits contact forms over
	 * fetch() to their data-fp-endpoint and shows an inline status message. ES5 so it
	 * runs everywhere without a build step. No inline event attributes (the FreshPress
	 * guardian forbids on*= in generated markup; this is added on the WP side only).
	 *
	 * @return string
	 */
	private static function handler_script() {
		return "\n<script data-fp-contact-handler>\n"
			. "(function(){\n"
			. "  var forms=document.querySelectorAll('form[data-fp-form=\"contact\"]');\n"
			. "  for(var i=0;i<forms.length;i++){(function(form){\n"
			. "    var endpoint=form.getAttribute('data-fp-endpoint');\n"
			. "    if(!endpoint)return;\n"
			. "    form.addEventListener('submit',function(e){\n"
			. "      e.preventDefault();\n"
			. "      var status=form.querySelector('.fp-contact-status');\n"
			. "      if(!status){status=document.createElement('p');status.className='fp-contact-status';form.appendChild(status);}\n"
			. "      function val(n){var el=form.querySelector('[name=\"'+n+'\"]');return el?el.value:'';}\n"
			. "      var btn=form.querySelector('button,[type=\"submit\"]');\n"
			. "      if(btn)btn.disabled=true;\n"
			. "      status.textContent='Sending\\u2026';\n"
			. "      fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:val('name'),email:val('email'),message:val('message'),pagePath:window.location.pathname})})\n"
			. "        .then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {ok:r.ok,body:b};});})\n"
			. "        .then(function(res){\n"
			. "          if(res.ok&&res.body&&res.body.ok){status.textContent='Thanks \\u2014 your message has been sent.';form.reset();}\n"
			. "          else{status.textContent=(res.body&&res.body.error)?res.body.error:'Sorry, something went wrong. Please try again.';}\n"
			. "        })\n"
			. "        .catch(function(){status.textContent='Sorry, something went wrong. Please try again.';})\n"
			. "        .then(function(){if(btn)btn.disabled=false;});\n"
			. "    });\n"
			. "  })(forms[i]);}\n"
			. "})();\n"
			. "</script>\n";
	}

	/**
	 * Signup twin of handler_script(): posts name/email to the signup endpoint and
	 * tells the visitor to check their inbox (double opt-in — the subscription is
	 * only live once they click the confirmation email).
	 *
	 * @return string
	 */
	private static function signup_handler_script() {
		return "\n<script data-fp-signup-handler>\n"
			. "(function(){\n"
			. "  var forms=document.querySelectorAll('form[data-fp-form=\"signup\"]');\n"
			. "  for(var i=0;i<forms.length;i++){(function(form){\n"
			. "    var endpoint=form.getAttribute('data-fp-endpoint');\n"
			. "    if(!endpoint)return;\n"
			. "    form.addEventListener('submit',function(e){\n"
			. "      e.preventDefault();\n"
			. "      var status=form.querySelector('.fp-signup-status');\n"
			. "      if(!status){status=document.createElement('p');status.className='fp-signup-status';form.appendChild(status);}\n"
			. "      function val(n){var el=form.querySelector('[name=\"'+n+'\"]');return el?el.value:'';}\n"
			. "      var btn=form.querySelector('button,[type=\"submit\"]');\n"
			. "      if(btn)btn.disabled=true;\n"
			. "      status.textContent='Subscribing\\u2026';\n"
			. "      fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:val('name'),email:val('email'),pagePath:window.location.pathname})})\n"
			. "        .then(function(r){return r.json().catch(function(){return {};}).then(function(b){return {ok:r.ok,body:b};});})\n"
			. "        .then(function(res){\n"
			. "          if(res.ok&&res.body&&res.body.ok){status.textContent='Almost there \\u2014 check your inbox to confirm your subscription.';form.reset();}\n"
			. "          else{status.textContent=(res.body&&res.body.error)?res.body.error:'Sorry, something went wrong. Please try again.';}\n"
			. "        })\n"
			. "        .catch(function(){status.textContent='Sorry, something went wrong. Please try again.';})\n"
			. "        .then(function(){if(btn)btn.disabled=false;});\n"
			. "    });\n"
			. "  })(forms[i]);}\n"
			. "})();\n"
			. "</script>\n";
	}
}
