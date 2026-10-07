<?php
/**
 * Full-bleed canvas for FreshPress-managed pages: no theme chrome, just the
 * synced fragment between wp_head() and wp_footer().
 *
 * The stored HTML is echoed raw ON PURPOSE: it is server-rendered by
 * FreshPress (which sanitizes at generation time), fetched over an
 * authenticated connection, and written only by the sync engine — running it
 * through kses here would strip the inline <style> blocks the design depends on.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php
echo get_post_meta( get_queried_object_id(), FP_Sync_Engine::META_HTML, true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- see header comment.
wp_footer();
?>
</body>
</html>
