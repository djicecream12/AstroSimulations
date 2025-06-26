# rocket trajectory simulation

def rocket_trajectory_simulation():
    # Constants
    g = 9.81 # gravity (m/s^2)
    rho = 1.225 # air density at sea level (kg/m^3)
    Cd = 0.75 # drag coefficient
    A = 0.03 # cross-sectional area (m^2)
    m = 50 # mass of rocket (kg)
    F_thrust = 1500 # constant thrust (N)

    # Initial conditions
    y = 0.0 # altitude (m)
    v = 0.0 # velocity (m/s)
    dt = 0.01 # time step (s)
    t = 0.0 # initial time
    max_time = 30 # max. simulation time (s)

    # Lists to store time, altitude, velocity for analysis
    time_data = []
    altitude_data = []
    velocity_data = []

    while y>= 0 and t < max_time:
        # Calculate drag force
        F_drag = 0.5 * rho * Cd * A * v * abs(v)

        # Calculate acceleration
        a = (F_thrust - m * g - F_drag) / m

        # Update velocity and position
        v = v + a * dt
        y = y + v * dt

        # Store data
        time_data.append(t)
        altitude_data.append(y)
        velocity_data.append(v)

        # Update time
        t += dt

        # Stop if rocket hits ground
        if y < 0:
            break

        # Results
        max_altitude = max(altitude_data)
    print(f"Max altitude reached: {max_altitude:.2f} meters")
    print(f"Flight time: {t:.2f} seconds")

if __name__ == "__main__":
    rocket_trajectory_simulation()