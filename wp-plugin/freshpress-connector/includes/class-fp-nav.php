<?php
/**
 * Nav menu builder (Phase 2, Chunk 4).
 *
 * Each non-dry sync rebuilds a WordPress nav menu named "FreshPress" from the
 * manifest: one item per synced page, in manifest order, with the parent_slug
 * tree reproduced via menu-item parents. The menu is deliberately NOT assigned
 * to a theme location — the admin does that once in Appearance → Menus; after
 * that, refreshes keep the same menu (same term) up to date.
 *
 * Rebuild-from-scratch each sync is intentional: it's the simplest way to keep
 * order + hierarchy exact, and sync is a low-frequency operation.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Nav {

	const MENU_NAME = 'FreshPress';

	/**
	 * Rebuild the "FreshPress" menu from the manifest.
	 *
	 * @param array $pages    Manifest pages (id, slug, title, parent_slug).
	 * @param array $post_ids fp-page-id => WP post id.
	 * @return int|WP_Error Number of menu items created, or WP_Error on failure.
	 */
	public static function sync_menu( $pages, $post_ids ) {
		if ( ! function_exists( 'wp_create_nav_menu' ) ) {
			require_once ABSPATH . 'wp-admin/includes/nav-menu.php';
		}

		$menu    = wp_get_nav_menu_object( self::MENU_NAME );
		$menu_id = $menu ? (int) $menu->term_id : wp_create_nav_menu( self::MENU_NAME );
		if ( is_wp_error( $menu_id ) ) {
			return $menu_id;
		}
		$menu_id = (int) $menu_id;
		if ( ! $menu_id ) {
			return new WP_Error( 'freshpress_menu', __( 'Could not create the FreshPress menu.', 'freshpress-connector' ) );
		}

		// Full rebuild: clear existing items first.
		$existing = wp_get_nav_menu_items( $menu_id, array( 'post_status' => 'any' ) );
		if ( is_array( $existing ) ) {
			foreach ( $existing as $item ) {
				wp_delete_post( $item->ID, true );
			}
		}

		// First pass: one menu item per synced page; remember slug -> menu-item id.
		$page_item    = array(); // fp page id -> menu item id
		$slug_to_item = array(); // manifest slug -> menu item id
		foreach ( $pages as $page ) {
			if ( empty( $page['id'] ) || ! isset( $post_ids[ $page['id'] ] ) ) {
				continue;
			}
			$item_id = self::upsert_item( $menu_id, 0, $page, $post_ids[ $page['id'] ], 0 );
			if ( is_wp_error( $item_id ) || ! $item_id ) {
				continue;
			}
			$page_item[ $page['id'] ] = (int) $item_id;
			if ( isset( $page['slug'] ) ) {
				$slug_to_item[ $page['slug'] ] = (int) $item_id;
			}
		}

		// Second pass: link parents (children may precede parents in manifest order).
		foreach ( $pages as $page ) {
			if ( empty( $page['parent_slug'] ) || ! isset( $page_item[ $page['id'] ] ) ) {
				continue;
			}
			if ( isset( $slug_to_item[ $page['parent_slug'] ] ) ) {
				self::upsert_item( $menu_id, $page_item[ $page['id'] ], $page, $post_ids[ $page['id'] ], $slug_to_item[ $page['parent_slug'] ] );
			}
		}

		return count( $page_item );
	}

	/**
	 * Create or update one menu item pointing at a synced page. Passing the full
	 * identifying args on every call (even when only setting the parent) keeps
	 * wp_update_nav_menu_item from clobbering the item.
	 *
	 * @param int   $menu_id
	 * @param int   $item_id   0 to create, else the item to update.
	 * @param array $page      Manifest entry.
	 * @param int   $post_id   Target WP post id.
	 * @param int   $parent_id Menu-item parent id (0 for top level).
	 * @return int|WP_Error
	 */
	private static function upsert_item( $menu_id, $item_id, $page, $post_id, $parent_id ) {
		return wp_update_nav_menu_item(
			$menu_id,
			(int) $item_id,
			array(
				'menu-item-title'     => isset( $page['title'] ) && '' !== $page['title'] ? $page['title'] : $page['slug'],
				'menu-item-object'    => 'page',
				'menu-item-object-id' => (int) $post_id,
				'menu-item-type'      => 'post_type',
				'menu-item-status'    => 'publish',
				'menu-item-parent-id' => (int) $parent_id,
			)
		);
	}
}
