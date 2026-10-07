<?php
/**
 * Uninstall: remove plugin state, keep content.
 *
 * Synced pages and sideloaded media are deliberately left in place — deleting
 * a site's pages because an admin removed a plugin is never the right default.
 * The managed/_freshpress_* meta stays with them so reinstalling reconnects
 * cleanly instead of duplicating pages.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'freshpress_connector_settings' );
delete_option( 'freshpress_connector_last_report' );
delete_transient( 'freshpress_connector_result' );
delete_transient( 'freshpress_connector_last_cron_report' );
wp_clear_scheduled_hook( 'freshpress_connector_sync' );
