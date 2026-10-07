<?php
/**
 * Canvas rendering for managed pages + the managed-page admin notice.
 *
 * FreshPress pages arrive as self-contained fragments (inline styles hoisted in
 * front of the body content), so the active theme's CSS would fight them. The
 * template_include filter swaps in a minimal full-bleed template for any post
 * carrying _freshpress_managed, keeping wp_head/wp_footer so plugins, analytics
 * and the admin bar still work.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Canvas {

	public static function init() {
		add_filter( 'template_include', array( __CLASS__, 'maybe_use_canvas' ), 99 );
		add_action( 'admin_notices', array( __CLASS__, 'managed_page_notice' ) );
		add_filter( 'body_class', array( __CLASS__, 'body_class' ) );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'filter_document_title' ) );
		add_action( 'wp_head', array( __CLASS__, 'meta_description' ), 1 );
	}

	/**
	 * A major SEO plugin managing titles/descriptions, or '' if none. We defer to
	 * Yoast / Rank Math rather than fight them for the document title + meta description.
	 *
	 * @return string Plugin name, or ''.
	 */
	public static function active_seo_plugin() {
		if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Frontend' ) ) {
			return 'Yoast SEO';
		}
		if ( defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' ) ) {
			return 'Rank Math';
		}
		return '';
	}

	/** Use the page's FreshPress SEO title (relies on the theme's title-tag support). */
	public static function filter_document_title( $title ) {
		if ( self::active_seo_plugin() || ! self::is_managed_page() ) {
			return $title;
		}
		$seo = get_post_meta( get_queried_object_id(), FP_Sync_Engine::META_SEO_TITLE, true );
		return $seo ? $seo : $title;
	}

	/** Emit the page's FreshPress meta description into the canvas <head>. */
	public static function meta_description() {
		if ( self::active_seo_plugin() || ! self::is_managed_page() ) {
			return;
		}
		$desc = get_post_meta( get_queried_object_id(), FP_Sync_Engine::META_SEO_DESC, true );
		if ( $desc ) {
			echo '<meta name="description" content="' . esc_attr( $desc ) . '" />' . "\n";
		}
	}

	public static function is_managed_page() {
		return is_singular( 'page' ) && get_post_meta( get_queried_object_id(), FP_Sync_Engine::META_MANAGED, true );
	}

	public static function maybe_use_canvas( $template ) {
		if ( self::is_managed_page() && get_post_meta( get_queried_object_id(), FP_Sync_Engine::META_HTML, true ) ) {
			return FRESHPRESS_CONNECTOR_DIR . 'templates/canvas.php';
		}
		return $template;
	}

	public static function body_class( $classes ) {
		if ( self::is_managed_page() ) {
			$classes[] = 'freshpress-canvas';
		}
		return $classes;
	}

	/** Warn editors that local edits to a managed page will be overwritten. */
	public static function managed_page_notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'post' !== $screen->base ) {
			return;
		}
		$post_id = isset( $_GET['post'] ) ? absint( $_GET['post'] ) : 0;
		if ( ! $post_id || ! get_post_meta( $post_id, FP_Sync_Engine::META_MANAGED, true ) ) {
			return;
		}
		$synced = get_post_meta( $post_id, FP_Sync_Engine::META_SYNCED_AT, true );
		printf(
			'<div class="notice notice-warning"><p><strong>%1$s</strong> %2$s%3$s</p></div>',
			esc_html__( 'This page is managed by FreshPress.', 'freshpress-connector' ),
			esc_html__( 'Its content is synced from your FreshPress site — changes made here will be overwritten on the next sync. Edit it in FreshPress instead.', 'freshpress-connector' ),
			$synced ? ' ' . esc_html( sprintf(
				/* translators: %s: ISO-8601 timestamp of the last sync */
				__( '(Last synced: %s)', 'freshpress-connector' ),
				$synced
			) ) : ''
		);
	}
}
