<?php
/**
 * Settings screen (Settings -> FreshPress) + the admin-post actions behind the
 * Test connection / Sync now / Dry run buttons. Everything requires
 * manage_options and a nonce; results travel via a short-lived transient so
 * they survive the redirect back to the settings page.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class FP_Settings {

	const RESULT_TRANSIENT = 'freshpress_connector_result';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_post_fp_test_connection', array( __CLASS__, 'handle_test_connection' ) );
		add_action( 'admin_post_fp_sync', array( __CLASS__, 'handle_sync' ) );
	}

	public static function register_menu() {
		add_options_page(
			__( 'FreshPress Connector', 'freshpress-connector' ),
			__( 'FreshPress', 'freshpress-connector' ),
			'manage_options',
			'freshpress-connector',
			array( __CLASS__, 'render_page' )
		);
	}

	public static function register_settings() {
		register_setting(
			'freshpress_connector',
			FRESHPRESS_CONNECTOR_OPTION,
			array( 'sanitize_callback' => array( __CLASS__, 'sanitize_settings' ) )
		);
	}

	public static function sanitize_settings( $input ) {
		$current = freshpress_connector_get_settings();
		$input   = is_array( $input ) ? $input : array();

		$clean = array(
			'base_url'       => isset( $input['base_url'] ) ? untrailingslashit( esc_url_raw( trim( $input['base_url'] ) ) ) : $current['base_url'],
			// An empty token field means "keep the saved one" — the UI never echoes it back.
			'token'          => ( isset( $input['token'] ) && '' !== trim( $input['token'] ) ) ? sanitize_text_field( trim( $input['token'] ) ) : $current['token'],
			'set_front_page' => empty( $input['set_front_page'] ) ? 0 : 1,
			'draft_removed'  => empty( $input['draft_removed'] ) ? 0 : 1,
			'cron_enabled'   => empty( $input['cron_enabled'] ) ? 0 : 1,
		);

		// (Re)schedule after the option is written, when the new value is readable.
		add_action( 'updated_option', function ( $option ) {
			if ( FRESHPRESS_CONNECTOR_OPTION === $option ) {
				freshpress_connector_sync_cron_schedule();
			}
		}, 10, 1 );

		return $clean;
	}

	public static function handle_test_connection() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'freshpress-connector' ) );
		}
		check_admin_referer( 'fp_test_connection' );

		$client = new FP_Api_Client();
		$result = $client->test_connection();

		if ( is_wp_error( $result ) ) {
			set_transient( self::RESULT_TRANSIENT, array( 'type' => 'error', 'message' => $result->get_error_message() ), MINUTE_IN_SECONDS * 5 );
		} else {
			$message = sprintf(
				/* translators: 1: site name, 2: page count */
				__( 'Connected to "%1$s" — %2$d published page(s).', 'freshpress-connector' ),
				$result['site_name'],
				$result['page_count']
			);
			if ( empty( $result['last_published_at'] ) ) {
				$message .= ' ' . __( 'Nothing has been published yet, so a sync would import nothing.', 'freshpress-connector' );
			}
			set_transient( self::RESULT_TRANSIENT, array( 'type' => 'success', 'message' => $message ), MINUTE_IN_SECONDS * 5 );
		}

		wp_safe_redirect( admin_url( 'options-general.php?page=freshpress-connector' ) );
		exit;
	}

	public static function handle_sync() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'freshpress-connector' ) );
		}
		check_admin_referer( 'fp_sync' );

		$dry_run = ! empty( $_POST['dry_run'] );
		$engine  = new FP_Sync_Engine( new FP_Api_Client() );
		$report  = $engine->sync( $dry_run );

		set_transient( self::RESULT_TRANSIENT, array( 'type' => 'report', 'report' => $report ), MINUTE_IN_SECONDS * 5 );
		wp_safe_redirect( admin_url( 'options-general.php?page=freshpress-connector' ) );
		exit;
	}

	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = freshpress_connector_get_settings();
		$result   = get_transient( self::RESULT_TRANSIENT );
		if ( $result ) {
			delete_transient( self::RESULT_TRANSIENT );
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'FreshPress Connector', 'freshpress-connector' ); ?></h1>

			<?php self::render_result( $result ); ?>

			<form method="post" action="options.php">
				<?php settings_fields( 'freshpress_connector' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="fp-base-url"><?php esc_html_e( 'FreshPress app URL', 'freshpress-connector' ); ?></label></th>
						<td>
							<input type="url" id="fp-base-url" class="regular-text code"
								name="<?php echo esc_attr( FRESHPRESS_CONNECTOR_OPTION ); ?>[base_url]"
								value="<?php echo esc_attr( $settings['base_url'] ); ?>"
								placeholder="https://app.example.com" />
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="fp-token"><?php esc_html_e( 'Connector token', 'freshpress-connector' ); ?></label></th>
						<td>
							<input type="password" id="fp-token" class="regular-text code" autocomplete="off"
								name="<?php echo esc_attr( FRESHPRESS_CONNECTOR_OPTION ); ?>[token]"
								value="" placeholder="<?php echo esc_attr( $settings['token'] ? __( '(saved — enter to replace)', 'freshpress-connector' ) : '' ); ?>" />
							<p class="description"><?php esc_html_e( 'Issued once per site from the FreshPress dashboard. Saving a new token replaces the old one; leave blank to keep the saved token.', 'freshpress-connector' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Behavior', 'freshpress-connector' ); ?></th>
						<td>
							<label>
								<input type="checkbox" name="<?php echo esc_attr( FRESHPRESS_CONNECTOR_OPTION ); ?>[set_front_page]" value="1" <?php checked( $settings['set_front_page'] ); ?> />
								<?php esc_html_e( 'Use the FreshPress home page as the site front page', 'freshpress-connector' ); ?>
							</label><br />
							<label>
								<input type="checkbox" name="<?php echo esc_attr( FRESHPRESS_CONNECTOR_OPTION ); ?>[draft_removed]" value="1" <?php checked( $settings['draft_removed'] ); ?> />
								<?php esc_html_e( 'Move pages removed in FreshPress to draft (never deleted)', 'freshpress-connector' ); ?>
							</label><br />
							<label>
								<input type="checkbox" name="<?php echo esc_attr( FRESHPRESS_CONNECTOR_OPTION ); ?>[cron_enabled]" value="1" <?php checked( $settings['cron_enabled'] ); ?> />
								<?php esc_html_e( 'Sync automatically twice a day', 'freshpress-connector' ); ?>
							</label>
						</td>
					</tr>
				</table>
				<?php submit_button( __( 'Save settings', 'freshpress-connector' ) ); ?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'Connection & sync', 'freshpress-connector' ); ?></h2>
			<?php self::render_last_sync(); ?>
			<div style="display:flex; gap:8px; align-items:center;">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="fp_test_connection" />
					<?php wp_nonce_field( 'fp_test_connection' ); ?>
					<?php submit_button( __( 'Test connection', 'freshpress-connector' ), 'secondary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="fp_sync" />
					<input type="hidden" name="dry_run" value="1" />
					<?php wp_nonce_field( 'fp_sync' ); ?>
					<?php submit_button( __( 'Dry run', 'freshpress-connector' ), 'secondary', 'submit', false ); ?>
				</form>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="display:inline;">
					<input type="hidden" name="action" value="fp_sync" />
					<?php wp_nonce_field( 'fp_sync' ); ?>
					<?php submit_button( __( 'Sync now', 'freshpress-connector' ), 'primary', 'submit', false ); ?>
				</form>
			</div>
		</div>
		<?php
	}

	/** Persistent "Last sync" line — reflects the most recent real sync from any trigger (button, cron, WP-CLI). */
	private static function render_last_sync() {
		$last = get_option( FP_Sync_Engine::LAST_REPORT_OPTION );
		if ( empty( $last ) || ! is_array( $last ) ) {
			echo '<p class="description">' . esc_html__( 'Last sync: never.', 'freshpress-connector' ) . '</p>';
			return;
		}
		$when = ! empty( $last['ran_at'] )
			? date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $last['ran_at'] ) )
			: '';
		$summary = sprintf(
			/* translators: 1: created, 2: updated, 3: skipped, 4: drafted, 5: errors */
			__( '%1$d created / %2$d updated / %3$d skipped / %4$d drafted / %5$d errors', 'freshpress-connector' ),
			(int) $last['created'],
			(int) $last['updated'],
			(int) $last['skipped'],
			(int) $last['drafted'],
			(int) $last['errors']
		);
		echo '<p class="description"><strong>' . esc_html__( 'Last sync:', 'freshpress-connector' ) . '</strong> '
			. esc_html( ( $when ? $when : '—' ) . ' — ' . $summary );
		if ( ! empty( $last['error'] ) ) {
			echo ' — ' . esc_html( $last['error'] );
		}
		echo '</p>';
	}

	private static function render_result( $result ) {
		if ( empty( $result ) || ! is_array( $result ) ) {
			return;
		}

		if ( 'report' !== $result['type'] ) {
			printf(
				'<div class="notice notice-%1$s is-dismissible"><p>%2$s</p></div>',
				'success' === $result['type'] ? 'success' : 'error',
				esc_html( $result['message'] )
			);
			return;
		}

		$report = $result['report'];
		$class  = ! empty( $report['ok'] ) ? 'success' : 'error';
		$label  = ! empty( $report['dry_run'] )
			? __( 'Dry run — nothing was written:', 'freshpress-connector' )
			: __( 'Sync finished:', 'freshpress-connector' );

		echo '<div class="notice notice-' . esc_attr( $class ) . '"><p><strong>' . esc_html( $label ) . '</strong></p>';
		if ( ! empty( $report['error'] ) ) {
			echo '<p>' . esc_html( $report['error'] ) . '</p>';
		}
		if ( ! empty( $report['nav_note'] ) ) {
			echo '<p>' . esc_html( $report['nav_note'] ) . '</p>';
		}
		if ( ! empty( $report['seo_note'] ) ) {
			echo '<p>' . esc_html( $report['seo_note'] ) . '</p>';
		}
		if ( ! empty( $report['actions'] ) ) {
			echo '<table class="widefat striped" style="max-width:720px; margin:8px 0;"><thead><tr>';
			echo '<th>' . esc_html__( 'Page', 'freshpress-connector' ) . '</th>';
			echo '<th>' . esc_html__( 'Action', 'freshpress-connector' ) . '</th>';
			echo '<th>' . esc_html__( 'Detail', 'freshpress-connector' ) . '</th>';
			echo '</tr></thead><tbody>';
			foreach ( $report['actions'] as $action ) {
				echo '<tr>';
				echo '<td>' . esc_html( $action['title'] ? $action['title'] : $action['slug'] ) . '</td>';
				echo '<td><code>' . esc_html( $action['action'] ) . '</code></td>';
				echo '<td>' . esc_html( $action['detail'] ) . '</td>';
				echo '</tr>';
			}
			echo '</tbody></table>';
		}
		echo '</div>';
	}
}
