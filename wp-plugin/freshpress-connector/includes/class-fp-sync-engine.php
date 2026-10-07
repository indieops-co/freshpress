<?php
/**
 * Sync engine: manifest -> WordPress pages.
 *
 * FreshPress is the source of truth. Every synced page is "managed": its
 * canonical HTML lives in the _freshpress_html meta (echoed raw by the canvas
 * template — WP content filters like wpautop/kses would mangle the inline
 * <style> blocks if it went through post_content), while post_content holds
 * only the plain-text excerpt so search still works.
 *
 * Hash gate: a page is skipped without fetching its payload when the stored
 * _freshpress_content_hash equals the manifest's content_hash. FreshPress
 * computes the hash over the same rendered output it serves, so "equal hash"
 * is exactly "nothing changed" (design changes move the hash too — the
 * stylesheet ships inline in the rendered page).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Sync_Engine {

	const META_PAGE_ID     = '_freshpress_page_id';
	const META_HASH        = '_freshpress_content_hash';
	const META_HTML        = '_freshpress_html';
	const META_MANAGED     = '_freshpress_managed';
	const META_SYNCED_AT   = '_freshpress_synced_at';
	const META_SEO_TITLE   = '_freshpress_seo_title';
	const META_SEO_DESC    = '_freshpress_seo_description';
	const META_SOURCE_URL  = '_freshpress_source_url'; // on attachments

	/** Trimmed summary of the last non-dry sync — so the settings page can show cron/CLI outcomes. */
	const LAST_REPORT_OPTION = 'freshpress_connector_last_report';

	/** @var FP_Api_Client */
	private $client;

	/** @var string Public contact endpoint from the current manifest (for contact-form wiring). */
	private $contact_endpoint = '';
	private $signup_endpoint  = '';

	public function __construct( FP_Api_Client $client ) {
		$this->client = $client;
	}

	/**
	 * Run a sync (or a dry run, which fetches only the manifest and reports
	 * what WOULD happen without writing anything).
	 *
	 * @param bool $dry_run
	 * @return array Report: { ok, dry_run, error?, site?, actions: [ {page_id, slug, title, action, detail?} ] }
	 */
	public function sync( $dry_run = false ) {
		$report = $this->run_sync( $dry_run );
		// Persist a trimmed summary of every real sync (button, cron, or WP-CLI) so the
		// settings page can always show the last outcome — even one it didn't trigger —
		// and post it back to FreshPress (fire-and-forget) for the dashboard.
		if ( ! $dry_run ) {
			$summary = self::summarize_report( $report );
			update_option( self::LAST_REPORT_OPTION, $summary, false );
			$this->client->post_sync_report( $summary );
		}
		return $report;
	}

	/**
	 * Collapse a full report to counts + timestamp for persistence/display.
	 *
	 * @param array $report
	 * @return array { ran_at, ok, site, created, updated, skipped, drafted, errors, error }
	 */
	public static function summarize_report( $report ) {
		$counts = array( 'create' => 0, 'update' => 0, 'skip' => 0, 'draft' => 0, 'error' => 0 );
		if ( ! empty( $report['actions'] ) && is_array( $report['actions'] ) ) {
			foreach ( $report['actions'] as $a ) {
				$action = isset( $a['action'] ) ? $a['action'] : '';
				if ( isset( $counts[ $action ] ) ) {
					$counts[ $action ]++;
				}
			}
		}
		return array(
			'ran_at'  => isset( $report['ran_at'] ) ? $report['ran_at'] : gmdate( 'c' ),
			'ok'      => ! empty( $report['ok'] ),
			'site'    => isset( $report['site'] ) ? $report['site'] : '',
			'created' => $counts['create'],
			'updated' => $counts['update'],
			'skipped' => $counts['skip'],
			'drafted' => $counts['draft'],
			'errors'  => $counts['error'],
			'error'   => isset( $report['error'] ) ? $report['error'] : '',
		);
	}

	/** @see sync() — the actual work; sync() wraps this to persist the summary. */
	private function run_sync( $dry_run = false ) {
		$report = array(
			'ok'      => false,
			'dry_run' => (bool) $dry_run,
			'ran_at'  => gmdate( 'c' ),
			'actions' => array(),
		);

		$manifest = $this->client->get_manifest();
		if ( is_wp_error( $manifest ) ) {
			$report['error'] = $manifest->get_error_message();
			return $report;
		}

		$report['site'] = isset( $manifest['site']['name'] ) ? $manifest['site']['name'] : '';
		$this->contact_endpoint = isset( $manifest['site']['contact_endpoint'] ) ? (string) $manifest['site']['contact_endpoint'] : '';
		$this->signup_endpoint  = isset( $manifest['site']['signup_endpoint'] ) ? (string) $manifest['site']['signup_endpoint'] : '';
		$pages          = isset( $manifest['pages'] ) && is_array( $manifest['pages'] ) ? $manifest['pages'] : array();

		if ( empty( $pages ) ) {
			$report['ok']    = true;
			$report['error'] = __( 'The FreshPress site has no published pages yet — publish in FreshPress, then sync again.', 'freshpress-connector' );
			return $report;
		}

		$settings   = freshpress_connector_get_settings();
		$seen_ids   = array();
		$home_post  = 0;
		$post_ids   = array(); // fp page id -> WP post id (for the parent pass)

		foreach ( $pages as $page ) {
			if ( empty( $page['id'] ) ) {
				continue;
			}
			$seen_ids[] = $page['id'];
			$existing   = $this->find_managed_post( $page['id'] );
			$stored     = $existing ? get_post_meta( $existing->ID, self::META_HASH, true ) : '';

			if ( $existing && $stored === $page['content_hash'] ) {
				$post_ids[ $page['id'] ] = $existing->ID;
				if ( ! empty( $page['is_home'] ) ) {
					$home_post = $existing->ID;
				}
				// SEO is NOT part of content_hash (it's page metadata, not rendered HTML),
				// so a pure SEO edit lands here as a skip — reconcile it anyway. No payload
				// fetch needed; the manifest already carries seo_title/seo_description.
				if ( ! $dry_run ) {
					$this->store_seo_meta( $existing->ID, $page );
				}
				$report['actions'][] = $this->action( $page, 'skip', __( 'unchanged (hash match)', 'freshpress-connector' ) );
				continue;
			}

			if ( $dry_run ) {
				$report['actions'][] = $this->action( $page, $existing ? 'update' : 'create' );
				continue;
			}

			$result = $this->sync_one( $page, $existing );
			if ( is_wp_error( $result ) ) {
				$report['actions'][] = $this->action( $page, 'error', $result->get_error_message() );
				continue;
			}

			$post_ids[ $page['id'] ] = $result;
			if ( ! empty( $page['is_home'] ) ) {
				$home_post = $result;
			}
			$report['actions'][] = $this->action( $page, $existing ? 'update' : 'create' );
		}

		// Second pass: parents. Children can precede their parent in the
		// manifest, so parent linkage only becomes safe once every page exists.
		if ( ! $dry_run ) {
			$slug_to_post = array();
			foreach ( $pages as $page ) {
				if ( isset( $post_ids[ $page['id'] ] ) ) {
					$slug_to_post[ $page['slug'] ] = $post_ids[ $page['id'] ];
				}
			}
			foreach ( $pages as $page ) {
				if ( empty( $page['parent_slug'] ) || ! isset( $post_ids[ $page['id'] ] ) ) {
					continue;
				}
				if ( isset( $slug_to_post[ $page['parent_slug'] ] ) ) {
					$post_id = $post_ids[ $page['id'] ];
					$parent  = $slug_to_post[ $page['parent_slug'] ];
					if ( (int) get_post_field( 'post_parent', $post_id ) !== (int) $parent ) {
						wp_update_post( array( 'ID' => $post_id, 'post_parent' => $parent ) );
					}
				}
			}

			// Third pass: rewrite internal <a href> links to local WP permalinks. Runs
			// after every page exists AND parents are linked, so get_permalink() is
			// correct (permalinks include ancestors). Idempotent — already-local links
			// no longer match the FreshPress origin, so re-syncs are no-ops on them.
			$this->rewrite_links( $pages, $post_ids, $settings['base_url'] );

			// Refresh the "FreshPress" nav menu from the manifest hierarchy. Not assigned
			// to a theme location — the admin does that once in Appearance → Menus.
			$menu = FP_Nav::sync_menu( $pages, $post_ids );
			if ( is_wp_error( $menu ) ) {
				$report['nav_note'] = sprintf(
					/* translators: %s: error detail */
					__( 'Nav menu update failed: %s', 'freshpress-connector' ),
					$menu->get_error_message()
				);
			} else {
				$report['nav_note'] = sprintf(
					/* translators: %d: number of menu items */
					_n(
						'Menu "FreshPress" refreshed (%d item) — assign it to a theme location in Appearance → Menus.',
						'Menu "FreshPress" refreshed (%d items) — assign it to a theme location in Appearance → Menus.',
						$menu,
						'freshpress-connector'
					),
					$menu
				);
			}
		}

		// SEO output is skipped at render time when a major SEO plugin owns titles/meta;
		// surface that here (dry run included) so the admin isn't puzzled by missing tags.
		$seo_plugin = FP_Canvas::active_seo_plugin();
		if ( $seo_plugin ) {
			$report['seo_note'] = sprintf(
				/* translators: %s: SEO plugin name */
				__( 'Per-page SEO tags are not emitted — %s is active and manages titles and meta descriptions.', 'freshpress-connector' ),
				$seo_plugin
			);
		}

		// Managed pages that no longer exist upstream: draft, never delete.
		$orphans = $this->find_orphaned_posts( $seen_ids );
		foreach ( $orphans as $orphan ) {
			$fp_id  = get_post_meta( $orphan->ID, self::META_PAGE_ID, true );
			$pseudo = array( 'id' => $fp_id, 'slug' => $orphan->post_name, 'title' => $orphan->post_title );
			if ( $dry_run ) {
				$report['actions'][] = $this->action( $pseudo, ! empty( $settings['draft_removed'] ) ? 'draft' : 'keep', __( 'removed upstream', 'freshpress-connector' ) );
				continue;
			}
			if ( ! empty( $settings['draft_removed'] ) && 'draft' !== $orphan->post_status ) {
				wp_update_post( array( 'ID' => $orphan->ID, 'post_status' => 'draft' ) );
				$report['actions'][] = $this->action( $pseudo, 'draft', __( 'removed upstream', 'freshpress-connector' ) );
			}
		}

		// Front page: point WP at the FreshPress home page when asked to.
		if ( ! $dry_run && $home_post && ! empty( $settings['set_front_page'] ) ) {
			if ( 'page' !== get_option( 'show_on_front' ) || (int) get_option( 'page_on_front' ) !== (int) $home_post ) {
				update_option( 'show_on_front', 'page' );
				update_option( 'page_on_front', $home_post );
			}
		}

		$report['ok'] = true;
		return $report;
	}

	/**
	 * Create or update one managed page from its payload.
	 *
	 * @param array        $page     Manifest entry.
	 * @param WP_Post|null $existing Managed post, if any.
	 * @return int|WP_Error WP post ID.
	 */
	private function sync_one( $page, $existing ) {
		$payload = $this->client->get_page( $page['id'] );
		if ( is_wp_error( $payload ) ) {
			return $payload;
		}
		if ( empty( $payload['html'] ) || ! isset( $payload['content_hash'] ) ) {
			return new WP_Error( 'freshpress_bad_payload', __( 'Page payload is missing html or content_hash.', 'freshpress-connector' ) );
		}

		$html = $this->sideload_assets( $payload );
		$html = FP_Forms::wire_contact_forms( $html, $this->contact_endpoint );
		$html = FP_Forms::wire_signup_forms( $html, $this->signup_endpoint );

		$postarr = array(
			'post_type'    => 'page',
			'post_status'  => 'publish',
			'post_title'   => isset( $page['title'] ) ? $page['title'] : $page['slug'],
			'post_name'    => $page['slug'],
			// Plain-text excerpt only: canonical HTML lives in meta, out of
			// reach of wpautop/kses (see the class docblock).
			'post_content' => isset( $page['excerpt'] ) ? sanitize_textarea_field( $page['excerpt'] ) : '',
		);
		if ( $existing ) {
			$postarr['ID'] = $existing->ID;
		}

		$post_id = $existing ? wp_update_post( $postarr, true ) : wp_insert_post( $postarr, true );
		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		update_post_meta( $post_id, self::META_PAGE_ID, $page['id'] );
		update_post_meta( $post_id, self::META_HASH, $payload['content_hash'] );
		update_post_meta( $post_id, self::META_HTML, $html );
		update_post_meta( $post_id, self::META_MANAGED, 1 );
		update_post_meta( $post_id, self::META_SYNCED_AT, gmdate( 'c' ) );
		$this->store_seo_meta( $post_id, $page );

		return (int) $post_id;
	}

	/**
	 * Persist per-page SEO meta (title + description) from the manifest entry. Only
	 * writes when the value actually changed, so it stays cheap on the skip path where
	 * it also runs (SEO is not part of the content hash, so pure SEO edits skip).
	 *
	 * @param int   $post_id
	 * @param array $page Manifest entry (may carry seo_title / seo_description).
	 */
	private function store_seo_meta( $post_id, $page ) {
		$title = isset( $page['seo_title'] ) ? sanitize_text_field( $page['seo_title'] ) : '';
		$desc  = isset( $page['seo_description'] ) ? sanitize_text_field( $page['seo_description'] ) : '';
		if ( get_post_meta( $post_id, self::META_SEO_TITLE, true ) !== $title ) {
			update_post_meta( $post_id, self::META_SEO_TITLE, $title );
		}
		if ( get_post_meta( $post_id, self::META_SEO_DESC, true ) !== $desc ) {
			update_post_meta( $post_id, self::META_SEO_DESC, $desc );
		}
	}

	/**
	 * Rewrite internal <a href> links in each synced page's stored HTML to local WP
	 * permalinks. Only meta that actually changes is written, so re-syncs stay cheap.
	 * The caller guards this to non-dry-run only.
	 *
	 * @param array  $pages    Manifest pages.
	 * @param array  $post_ids fp-page-id => WP post id (every current manifest page).
	 * @param string $base_url Configured FreshPress app URL.
	 */
	private function rewrite_links( $pages, $post_ids, $base_url ) {
		if ( empty( $post_ids ) ) {
			return;
		}
		$map = FP_Links::build_permalink_map( $pages, $post_ids );
		if ( empty( $map ) ) {
			return;
		}
		foreach ( $post_ids as $post_id ) {
			$stored = get_post_meta( $post_id, self::META_HTML, true );
			if ( ! is_string( $stored ) || '' === $stored ) {
				continue;
			}
			$rewritten = FP_Links::rewrite_internal_links( $stored, $base_url, $map );
			if ( $rewritten !== $stored ) {
				update_post_meta( $post_id, self::META_HTML, $rewritten );
			}
		}
	}

	/**
	 * Sideload the payload's image assets into the media library and point the
	 * HTML at the local copies. Re-syncs reuse the attachment already imported
	 * for a given source URL instead of duplicating it.
	 *
	 * @param array $payload Page payload (html + assets).
	 * @return string HTML with asset URLs rewritten to local attachment URLs.
	 */
	private function sideload_assets( $payload ) {
		$html   = $payload['html'];
		$assets = isset( $payload['assets'] ) && is_array( $payload['assets'] ) ? $payload['assets'] : array();
		if ( empty( $assets ) ) {
			return $html;
		}

		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		foreach ( $assets as $asset ) {
			if ( empty( $asset['url'] ) ) {
				continue;
			}
			$source = $asset['url'];

			$local_url = $this->find_sideloaded_url( $source );
			if ( ! $local_url ) {
				$attachment_id = media_sideload_image( $source, 0, isset( $asset['alt'] ) ? $asset['alt'] : '', 'id' );
				if ( is_wp_error( $attachment_id ) ) {
					continue; // Leave the remote URL in place — the page still renders.
				}
				update_post_meta( $attachment_id, self::META_SOURCE_URL, $source );
				if ( ! empty( $asset['alt'] ) ) {
					update_post_meta( $attachment_id, '_wp_attachment_image_alt', sanitize_text_field( $asset['alt'] ) );
				}
				$local_url = wp_get_attachment_url( $attachment_id );
			}

			if ( $local_url ) {
				$html = str_replace( $source, $local_url, $html );
			}
		}

		return $html;
	}

	/** Attachment URL for an already-imported source URL, or '' if none. */
	private function find_sideloaded_url( $source_url ) {
		$found = get_posts( array(
			'post_type'      => 'attachment',
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_key'       => self::META_SOURCE_URL,
			'meta_value'     => $source_url,
		) );
		if ( empty( $found ) ) {
			return '';
		}
		$url = wp_get_attachment_url( $found[0] );
		return $url ? $url : '';
	}

	/** @return WP_Post|null The managed post for a FreshPress page id. */
	private function find_managed_post( $fp_page_id ) {
		$found = get_posts( array(
			'post_type'      => 'page',
			'post_status'    => 'any',
			'posts_per_page' => 1,
			'meta_key'       => self::META_PAGE_ID,
			'meta_value'     => $fp_page_id,
		) );
		return empty( $found ) ? null : $found[0];
	}

	/** @return WP_Post[] Managed pages whose FreshPress id is not in the manifest anymore. */
	private function find_orphaned_posts( $seen_ids ) {
		$managed = get_posts( array(
			'post_type'      => 'page',
			'post_status'    => array( 'publish', 'draft' ),
			'posts_per_page' => -1,
			'meta_key'       => self::META_MANAGED,
			'meta_value'     => 1,
		) );

		$orphans = array();
		foreach ( $managed as $post ) {
			$fp_id = get_post_meta( $post->ID, self::META_PAGE_ID, true );
			if ( $fp_id && ! in_array( $fp_id, $seen_ids, true ) ) {
				$orphans[] = $post;
			}
		}
		return $orphans;
	}

	private function action( $page, $action, $detail = '' ) {
		return array(
			'page_id' => isset( $page['id'] ) ? $page['id'] : '',
			'slug'    => isset( $page['slug'] ) ? $page['slug'] : '',
			'title'   => isset( $page['title'] ) ? $page['title'] : '',
			'action'  => $action,
			'detail'  => $detail,
		);
	}
}
