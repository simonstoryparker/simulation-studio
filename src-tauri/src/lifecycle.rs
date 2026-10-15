//! One lock arbitrates update installation against connections and session forwarding.
#[derive(Clone, Copy)]
pub enum Service {
    Control,
    Nt,
}
#[derive(Default)]
pub struct Lifecycle {
    pub installing: bool,
    control: bool,
    pub control_ready: bool,
    nt: bool,
}
impl Lifecycle {
    pub fn connected(&self, service: Service) -> bool {
        match service {
            Service::Control => self.control,
            Service::Nt => self.nt,
        }
    }
    pub fn accept(&mut self, service: Service) -> bool {
        if self.installing {
            return false;
        }
        match service {
            Service::Control => self.control = true,
            Service::Nt => self.nt = true,
        }
        true
    }
    pub fn disconnect(&mut self, service: Service) {
        match service {
            Service::Control => {
                self.control = false;
                self.control_ready = false;
            }
            Service::Nt => self.nt = false,
        }
    }
    pub fn prepare(&mut self) -> Result<(), String> {
        if self.installing {
            return Err("An update is already being installed".into());
        }
        if self.control || self.nt {
            return Err("Stop the simulation before updating Studio".into());
        }
        self.installing = true;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    #[test]
    fn either_connection_defers_installation() {
        for service in [Service::Control, Service::Nt] {
            let mut gate = Lifecycle::default();
            assert!(gate.accept(service));
            assert!(gate.prepare().is_err());
            gate.disconnect(service);
            assert!(gate.prepare().is_ok());
            assert!(!gate.accept(service)); // includes a connection whose dial was already in flight
            gate.installing = false;
            assert!(gate.accept(service)); // failed install permits recovery
        }
    }
    #[test]
    fn connection_and_installation_race_has_only_one_winner() {
        for _ in 0..100 {
            let gate = Arc::new(Mutex::new(Lifecycle::default()));
            let other = gate.clone();
            let connection =
                std::thread::spawn(move || other.lock().unwrap().accept(Service::Control));
            let installation = gate.lock().unwrap().prepare().is_ok();
            assert_ne!(installation, connection.join().unwrap());
        }
    }
}
