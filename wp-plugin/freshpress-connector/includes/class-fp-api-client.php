<?php
/**
 * HTTP client for the FreshPress Connect API.
 *
 * The connector token resolves to a single site server-side, so the client
 * only ever needs base_url + token. All methods return decoded arrays or
 * WP_Error — never raw responses.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Api_Client {

	/** @var string */
	private $base_url;

	/** @var string */
	private $token;

	public function __construct( $base_url = null, $token = null ) {
		$settings       = freshpress_connector_get_settings();
		$this->base_url = untrailingslashit( null !== $base_url ? $base_url : $settings['base_url'] );
		$this->token    = null !== $token ? $token : $settings['token'];
	}

	public function is_configured() {
		return '' !== $this->base_url && '' !== $this->token;
	}

	/** GET /api/connect/v1/manifest — also the "Test connection" probe. */
	public function get_manifest() {
		return $this->get( '/api/connect/v1/manifest' );
	}

	/** GET /api/connect/v1/pages/{id} — self-contained html + assets for one page. */
	public function get_page( $page_id ) {
		return $this->get( '/api/connect/v1/pages/' . rawurlencode( $page_id ) );
	}

	/**
	 * Test connection: manifest fetch reduced to a human-readable summary.
	 *
	 * @return array|WP_Error { site_name, page_count, last_published_at }
	 */
	public function test_connection() {
		$manifest = $this->get_manifest();
		if ( is_wp_error( $manifest ) ) {
			return $manifest;
		}
		return array(
			'site_name'         => isset( $manifest['site']['name'] ) ? $manifest['site']['name'] : '',
			'page_count'        => isset( $manifest['pages'] ) ? count( $manifest['pages'] ) : 0,
			'last_published_at' => isset( $manifest['site']['last_published_at'] ) ? $manifest['site']['last_published_at'] : null,
		);
	}

	/**
	 * POST a trimmed sync summary back to FreshPress so the dashboard can show the WP
	 * outcome (Phase 3, Chunk 6). Fire-and-forget: a failure here must NEVER fail the
	 * sync, so the result is ignored. Skipped when the plugin isn't configured.
	 *
	 * @param array $report Summary payload (counts + timestamp).
	 * @return void
	 */
	public function post_sync_report( $report ) {
		if ( ! $this->is_configured() ) {
			return;
		}
		wp_remote_post(
			$this->base_url . '/api/connect/v1/sync-report',
			array(
				'timeout' => 8,
				'headers' => array(
					'Authorization' => 'Bearer ' . $this->token,
					'Content-Type'  => 'application/json',
					'Accept'        => 'application/json',
				),
				'body'    => wp_json_encode( $report ),
			)
		);
	}

	/**
	 * @param string $path Absolute API path beginning with '/'.
	 * @return array|WP_Error Decoded JSON body.
	 */
	private function get( $path ) {
		if ( ! $this->is_configured() ) {
			return new WP_Error(
				'freshpress_not_configured',
				__( 'FreshPress Connector is not configured: set the app URL and connector token first.', 'freshpress-connector' )
			);
		}

		$response = wp_remote_get(
			$this->base_url . $path,
			array(
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $this->token,
					'Accept'        => 'application/json',
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		// 401 vs 429 are different failures with different fixes:
		// 401 = the token is wrong/rotated/revoked — the admin must paste a new one.
		// 429 = the token is fine but requests are too frequent — transient, retry later.
		if ( 401 === $code ) {
			return new WP_Error(
				'freshpress_unauthorized',
				__( 'FreshPress rejected the connector token (401). It may have been rotated or revoked — issue a new one in the FreshPress dashboard and paste it here.', 'freshpress-connector' )
			);
		}
		if ( 429 === $code ) {
			return new WP_Error(
				'freshpress_rate_limited',
				__( 'FreshPress is rate-limiting the connector (429) — too many requests in a short window. This is temporary: wait a minute and sync again, or let the twice-daily cron catch up.', 'freshpress-connector' )
			);
		}
		if ( $code < 200 || $code >= 300 ) {
			$message = is_array( $data ) && ! empty( $data['error'] ) ? $data['error'] : trim( wp_strip_all_tags( $body ) );
			return new WP_Error(
				'freshpress_http_' . $code,
				sprintf(
					/* translators: 1: HTTP status code, 2: error detail */
					__( 'FreshPress API error (HTTP %1$d): %2$s', 'freshpress-connector' ),
					$code,
					$message ? $message : __( 'no detail', 'freshpress-connector' )
				)
			);
		}
		if ( ! is_array( $data ) ) {
			return new WP_Error(
				'freshpress_bad_json',
				__( 'FreshPress API returned a response that is not valid JSON.', 'freshpress-connector' )
			);
		}

		return $data;
	}
}
