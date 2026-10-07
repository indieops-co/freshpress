<?php
/**
 * WP-CLI command (Phase 2, Chunk 5): `wp freshpress sync [--dry-run]`.
 *
 * Wraps the same FP_Sync_Engine the settings button and cron use, so a headless
 * sync behaves identically and its summary is persisted for the settings page.
 * Registered only under WP-CLI; a no-op in the web request.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! ( defined( 'WP_CLI' ) && WP_CLI ) ) {
	return;
}

class FP_CLI {

	/**
	 * Pull published FreshPress pages into WordPress.
	 *
	 * ## OPTIONS
	 *
	 * [--dry-run]
	 * : Report what a sync would create / update / skip / draft without writing anything.
	 *
	 * ## EXAMPLES
	 *
	 *     wp freshpress sync
	 *     wp freshpress sync --dry-run
	 *
	 * @when after_wp_load
	 */
	public function sync( $args, $assoc_args ) {
		$dry_run = ! empty( $assoc_args['dry-run'] );

		$engine = new FP_Sync_Engine( new FP_Api_Client() );
		$report = $engine->sync( $dry_run );

		// A hard failure (couldn't even fetch the manifest) has an error and no actions.
		if ( ! empty( $report['error'] ) && empty( $report['actions'] ) ) {
			WP_CLI::error( $report['error'] );
			return;
		}

		$rows = array();
		if ( ! empty( $report['actions'] ) ) {
			foreach ( $report['actions'] as $a ) {
				$rows[] = array(
					'page'   => '' !== $a['title'] ? $a['title'] : $a['slug'],
					'action' => $a['action'],
					'detail' => $a['detail'],
				);
			}
			WP_CLI\Utils\format_items( 'table', $rows, array( 'page', 'action', 'detail' ) );
		}

		foreach ( array( 'nav_note', 'seo_note' ) as $note ) {
			if ( ! empty( $report[ $note ] ) ) {
				WP_CLI::log( $report[ $note ] );
			}
		}

		$s   = FP_Sync_Engine::summarize_report( $report );
		$msg = sprintf(
			'%s — %d created, %d updated, %d skipped, %d drafted, %d error(s).',
			$dry_run ? 'Dry run' : 'Sync complete',
			$s['created'],
			$s['updated'],
			$s['skipped'],
			$s['drafted'],
			$s['errors']
		);

		if ( $s['errors'] > 0 ) {
			WP_CLI::warning( $msg );
		} else {
			WP_CLI::success( $msg );
		}
	}
}

WP_CLI::add_command( 'freshpress', 'FP_CLI' );
