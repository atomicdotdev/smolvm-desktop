//! Domain types shared across command modules.
//!
//! Organized by domain so feature additions edit a single file. Re-exported
//! flat so existing `use crate::types::*` and `use crate::types::Foo` keep
//! working.

mod common;
mod machine;
mod pack;
mod system;

pub use common::*;
pub use machine::*;
pub use pack::*;
pub use system::*;
