<?php
/**
 * Plugin Name:       FreshPress Connector
 * Plugin URI:        https://freshpress.dev
 * Description:       Pulls published pages from a FreshPress workspace into WordPress. Read-only sync: FreshPress stays the source of truth; pages are rendered through a full-bleed canvas template and skipped when unchanged (content-hash gated).
 * Version:           0.3.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            FreshPress
 * License:           GPL-2.0-or-later
 * Text Domain:       freshpress-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FRESHPRESS_CONNECTOR_VERSION', '0.3.0' );
define( 'FRESHPRESS_CONNECTOR_FILE', __FILE__ );
define( 'FRESHPRESS_CONNECTOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'FRESHPRESS_CONNECTOR_OPTION', 'freshpress_connector_settings' );
define( 'FRESHPRESS_CONNECTOR_CRON_HOOK', 'freshpress_connector_sync' );

require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-api-client.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-links.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-forms.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-nav.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-sync-engine.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-settings.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-canvas.php';
require_once FRESHPRESS_CONNECTOR_DIR . 'includes/class-fp-cli.php';

/** Default settings shape — single option row, filterable via get_settings(). */
function freshpress_connector_default_settings() {
	return array(
		'base_url'       => '',
		'token'          => '',
		'set_front_page' => 1,
		'draft_removed'  => 1,
		'cron_enabled'   => 0,
	);
}

function freshpress_connector_get_settings() {
	$saved = get_option( FRESHPRESS_CONNECTOR_OPTION, array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), freshpress_connector_default_settings() );
}

function freshpress_connector_activate() {
	if ( false === get_option( FRESHPRESS_CONNECTOR_OPTION, false ) ) {
		add_option( FRESHPRESS_CONNECTOR_OPTION, freshpress_connector_default_settings() );
	}
	freshpress_connector_sync_cron_schedule();
}
register_activation_hook( __FILE__, 'freshpress_connector_activate' );

function freshpress_connector_deactivate() {
	wp_clear_scheduled_hook( FRESHPRESS_CONNECTOR_CRON_HOOK );
}
register_deactivation_hook( __FILE__, 'freshpress_connector_deactivate' );

/** Keep the cron registration in step with the cron_enabled setting. */
function freshpress_connector_sync_cron_schedule() {
	$settings  = freshpress_connector_get_settings();
	$scheduled = wp_next_scheduled( FRESHPRESS_CONNECTOR_CRON_HOOK );

	if ( ! empty( $settings['cron_enabled'] ) && ! $scheduled ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'twicedaily', FRESHPRESS_CONNECTOR_CRON_HOOK );
	}
	if ( empty( $settings['cron_enabled'] ) && $scheduled ) {
		wp_clear_scheduled_hook( FRESHPRESS_CONNECTOR_CRON_HOOK );
	}
}

/** Scheduled sync — same engine as the button, never dry-run. The last-sync summary
 *  is persisted inside sync() itself, so the settings page shows the cron outcome. */
function freshpress_connector_cron_sync() {
	$engine = new FP_Sync_Engine( new FP_Api_Client() );
	$engine->sync( false );
}
add_action( FRESHPRESS_CONNECTOR_CRON_HOOK, 'freshpress_connector_cron_sync' );

add_action( 'plugins_loaded', function () {
	FP_Settings::init();
	FP_Canvas::init();
} );
