<?php
/**
 * Internal-link rewriting (Phase 2, Chunk 2).
 *
 * FreshPress renders anchors that point at the FreshPress app origin (root-relative
 * hrefs are absolutized against APP_URL when the page is served). After a sync, those
 * anchors should point at the LOCAL WordPress permalinks of the mapped pages so that
 * clicking between synced pages never leaves the WP site.
 *
 * The mapping is: <a href> path  ->  FreshPress page (by manifest `path`)  ->  WP post
 * ->  get_permalink(). External links and paths with no mapped page are left untouched.
 *
 * The two hot-path helpers here — extract_internal_path() and rewrite_internal_links() —
 * are deterministic and free of WordPress state (they take a precomputed permalink map),
 * so they can be reviewed and reasoned about in isolation. build_permalink_map() is the
 * only impure piece: it calls get_permalink() to turn post IDs into URLs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Links {

	/**
	 * Build [ normalized FreshPress path => WP permalink URL ] from the manifest pages
	 * and the fp-page-id -> WP-post-id map the sync engine already has. The home page
	 * ('/' path or is_home) is keyed under '/'.
	 *
	 * @param array $pages    Manifest pages (each may carry `id`, `path`, `is_home`).
	 * @param array $post_ids fp-page-id => WP post id.
	 * @return array normalized-path => permalink URL.
	 */
	public static function build_permalink_map( $pages, $post_ids ) {
		$map = array();
		foreach ( $pages as $page ) {
			if ( empty( $page['id'] ) || ! isset( $post_ids[ $page['id'] ] ) ) {
				continue;
			}
			$permalink = get_permalink( $post_ids[ $page['id'] ] );
			if ( ! $permalink ) {
				continue;
			}
			if ( isset( $page['path'] ) && '' !== $page['path'] ) {
				$map[ self::normalize_path( $page['path'] ) ] = $permalink;
			}
			if ( ! empty( $page['is_home'] ) ) {
				$map['/'] = $permalink;
			}
		}
		return $map;
	}

	/**
	 * Normalize a path to a stable map key: ensure a single leading slash and drop a
	 * trailing slash (except for the root). Query/fragment must already be stripped.
	 *
	 * @param string $path
	 * @return string
	 */
	public static function normalize_path( $path ) {
		$path = '/' . ltrim( (string) $path, '/' );
		if ( '/' !== $path ) {
			$path = rtrim( $path, '/' );
		}
		return '' === $path ? '/' : $path;
	}

	/**
	 * If $href is an internal FreshPress link, return its path+query+fragment (e.g.
	 * "/about?x=1#team"); otherwise null. Internal means root-relative OR an absolute
	 * URL whose host matches the configured FreshPress base URL. Fragment-only,
	 * mailto:, tel:, javascript: and data: links are never internal.
	 *
	 * @param string $href
	 * @param string $base_url Configured FreshPress app URL.
	 * @return string|null
	 */
	public static function extract_internal_path( $href, $base_url ) {
		$href = trim( (string) $href );
		if ( '' === $href || '#' === $href[0] ) {
			return null;
		}
		if ( preg_match( '#^(mailto:|tel:|javascript:|data:)#i', $href ) ) {
			return null;
		}

		// Root-relative ("/about"), but not protocol-relative ("//host/path").
		if ( '/' === $href[0] ) {
			if ( isset( $href[1] ) && '/' === $href[1] ) {
				return null;
			}
			return $href;
		}

		// Absolute URL: only internal when the host matches the FreshPress base URL.
		$base_host = wp_parse_url( $base_url, PHP_URL_HOST );
		$href_host = wp_parse_url( $href, PHP_URL_HOST );
		if ( ! $base_host || ! $href_host || strtolower( $base_host ) !== strtolower( $href_host ) ) {
			return null;
		}

		$path  = wp_parse_url( $href, PHP_URL_PATH );
		$query = wp_parse_url( $href, PHP_URL_QUERY );
		$frag  = wp_parse_url( $href, PHP_URL_FRAGMENT );
		$path  = ( null === $path || '' === $path ) ? '/' : $path;

		return $path
			. ( null !== $query && '' !== $query ? '?' . $query : '' )
			. ( null !== $frag && '' !== $frag ? '#' . $frag : '' );
	}

	/**
	 * Rewrite internal <a href> values in $html to local WP permalinks using $permalink_map
	 * (normalized-path => URL). Query strings and fragments on the original href are
	 * preserved. Anything not internal or not in the map is left exactly as-is. Pure:
	 * same inputs always produce the same output.
	 *
	 * @param string $html
	 * @param string $base_url
	 * @param array  $permalink_map normalized-path => permalink URL.
	 * @return string
	 */
	public static function rewrite_internal_links( $html, $base_url, $permalink_map ) {
		if ( '' === $html || empty( $permalink_map ) ) {
			return $html;
		}

		return preg_replace_callback(
			'#(<a\b[^>]*?\shref=)(["\'])(.*?)\2#i',
			function ( $m ) use ( $base_url, $permalink_map ) {
				$prefix = $m[1];
				$quote  = $m[2];
				$href   = $m[3];

				$internal = self::extract_internal_path( $href, $base_url );
				if ( null === $internal ) {
					return $m[0];
				}

				// Split path from ?query / #fragment for the lookup, keep the suffix.
				$suffix = '';
				$path   = $internal;
				$cut     = strcspn( $internal, '?#' );
				if ( $cut < strlen( $internal ) ) {
					$path   = substr( $internal, 0, $cut );
					$suffix = substr( $internal, $cut );
				}

				$key = self::normalize_path( $path );
				if ( ! isset( $permalink_map[ $key ] ) ) {
					return $m[0];
				}

				return $prefix . $quote . esc_url( $permalink_map[ $key ] ) . $suffix . $quote;
			},
			$html
		);
	}
}
