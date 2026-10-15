# Simplicity
- Make the UI/X as simple as possible. The enable/disable buttons need to be bigger
- Auto, tele, test needs to be a larger option
- Should be full match option where sim gui manages tele or auto
- Get rid of any fluff text, everything should just be clear
- Make estop not prominant
- If i add a chooser or tunable value, it should by default let me write to network tables. that shouldn't even be an option.

# Controls
- The only reason one would modify the controls is for a keyboard. make it so that there's a xbox diagram where if you click a button on the controller diagram, it will highlight and then prompt you to select a key. joysticks can be mapped as 4 keys for each direction. triggers should be one key.
- xbox controller preferrably 3d and draggable so you can go to the top where triggers are, etc.
  - if it is 3d, should be a simple outline style with minimal filling

# Layout
- The header doesn't make any sense with "Simulation Studio" on the left
- The name of the tab being next to the "remove tab" button doesn't make sense, just add an "X" to each tab to remove it
- Alliance should be a clearer, more prominant selector next to the enable/disable.
- I think it would make sense to have the robot state/enable disable stuff in a column on the left, and the configurable stuff on the right
- topics panel needs to collapse
- Controllers should just be a steady tab that's locked, opens the xbox controller view
- Robot current state and time elapsed should be next to each other

# Compact overlay feature
- It makes sense, especially when using ascope as the main simulation viewer, to make a compact overlay feature. This should be customizable.
- includes enable/disable, teleop, auto, test by default
- can add any number of custom topics like selected auto
  - should turn that into the most compact version of that possible
- the whole overlay should be resizable, and should be able to take up a tiny amount of the screen so i can put it in the corner and not have it cover the screen when running the auto for example

# Controller ports
- This is a prominant feature of the simulator tool. I'd like it to be as clear as possible what controller my keyboard is currently acting on, and some sort of interface to switch them in very little clicks. This should also be included on the compact overlay
  - an example workflow of this is:
    - i start the simulation
    - i enable in teleop
    - drive around, realize that i haven't homed the intake
    - i click a button on the overlay to switch my keyboard to act as the operator controller
    - i click a key to home intake
    - i switch back
  - a second example workflow of this is:
    - i start the simulation
    - i enable in teleop
    - drive around using my xbox controller, realize i haven't homed the intake
    - i look at the overlay to double check my keyboard is acting as the operator controller, my xbox controller is acting as the driver controller
    - i click a key on my keyboard to home the intake
    - i keep using my xbox controller to drive
