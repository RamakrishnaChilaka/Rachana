// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rachana_lib::configure_linux_webkit_rendering_before_startup();
    rachana_lib::run()
}
