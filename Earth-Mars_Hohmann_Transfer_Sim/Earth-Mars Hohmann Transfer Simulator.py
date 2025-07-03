import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from mpl_toolkits.mplot3d import Axes3D

# Orbital constants
AU = 1.496e+11  # meters, but we will use AU as base unit for plotting
earth_orbit_radius = 1.0  # AU
mars_orbit_radius = 1.52  # AU

# Make orbits slower
earth_orbital_period = 365.25 * 1.2  # 20% slower
mars_orbital_period = 687 * 1.2      # 20% slower

# Time scale
days_per_frame = 5
total_days = 2000  # total simulation length
num_frames = total_days // days_per_frame

# Angular speed = 2π / T
earth_omega = 2 * np.pi / earth_orbital_period
mars_omega = 2 * np.pi / mars_orbital_period


# Set up 3D plot
fig = plt.figure(figsize=(8,8))
ax = fig.add_subplot(111, projection='3d')
fig.patch.set_facecolor('black')
ax.set_facecolor('black')
ax.set_xlim(-2, 2)
ax.set_ylim(-2, 2)
ax.set_zlim(-2, 2)
ax.set_title("Earth-Mars Hohmann Transfer", color='white')
ax.set_box_aspect([1,1,1])

# Plot elements
# Set colors for better visibility on black
sun, = ax.plot([0], [0], [0], 'yo', markersize=18, label='Sun')  # Bigger sun
earth, = ax.plot([], [], [], 'bo', markersize=10, label='Earth')  # Bigger earth
mars, = ax.plot([], [], [], 'ro', markersize=7, label='Mars')  # Mars a bit smaller than earth

# Transfer orbit parameters
r1 = earth_orbit_radius
r2 = mars_orbit_radius
a_transfer = (r1 + r2) / 2
transfer_time = np.pi * np.sqrt(a_transfer**3)  # in "years" (1 year = 1 Earth orbital period)
transfer_days = transfer_time * earth_orbital_period  # in days, using new slower Earth period
transfer_frames = int(transfer_days // days_per_frame)

# Calculate phase angle for launch (where Mars should be at arrival)
# Mars must be ahead by the angle it will move during the transfer
mars_travel_angle = mars_omega * transfer_days
phase_angle = np.pi - mars_travel_angle

# Transfer orbit plot (half ellipse in 3D, z=0)
theta_transfer = np.linspace(0, np.pi, 300)
transfer_x = a_transfer * np.cos(theta_transfer) - (r2 - r1) / 2  # center-shifted
transfer_y = a_transfer * np.sin(theta_transfer)
transfer_z = np.zeros_like(transfer_x)
transfer_orbit, = ax.plot(transfer_x, transfer_y, transfer_z, linestyle='--', color='#90ff90', label='Hohmann Transfer')

# Spacecraft marker (lighter green)
spacecraft, = ax.plot([], [], [], marker='o', color='#90ff90', markersize=5, label='Spacecraft')

# Draw orbits in 3D (z=0)
phi = np.linspace(0, 2*np.pi, 300)
earth_orbit_x = earth_orbit_radius * np.cos(phi)
earth_orbit_y = earth_orbit_radius * np.sin(phi)
earth_orbit_z = np.zeros_like(phi)
ax.plot(earth_orbit_x, earth_orbit_y, earth_orbit_z, color='blue', linestyle='--', label='_nolegend_')
mars_orbit_x = mars_orbit_radius * np.cos(phi)
mars_orbit_y = mars_orbit_radius * np.sin(phi)
mars_orbit_z = np.zeros_like(phi)
ax.plot(mars_orbit_x, mars_orbit_y, mars_orbit_z, color='red', linestyle='--', label='_nolegend_')
# Place legend outside the plot with a title
leg = ax.legend(loc='center left', bbox_to_anchor=(1.02, 0.5), facecolor='black', edgecolor='white', labelcolor='white', title='Legend', borderpad=1.5, handletextpad=1.5, labelspacing=1.2)
# Set legend title color to white for visibility
leg.get_title().set_color('white')
leg.get_title().set_fontsize(13)
ax.tick_params(colors='white')

# Update function
def update(frame):
    day = frame * days_per_frame
    # Earth starts at 0, Mars starts ahead by phase_angle
    earth_angle = earth_omega * day
    mars_angle = phase_angle + mars_omega * day

    # Earth and Mars position (z=0)
    earth_x = earth_orbit_radius * np.cos(earth_angle)
    earth_y = earth_orbit_radius * np.sin(earth_angle)
    earth_z = 0
    mars_x = mars_orbit_radius * np.cos(mars_angle)
    mars_y = mars_orbit_radius * np.sin(mars_angle)
    mars_z = 0
    earth.set_data([earth_x], [earth_y])
    earth.set_3d_properties([earth_z])
    mars.set_data([mars_x], [mars_y])
    mars.set_3d_properties([mars_z])

    # Spacecraft transfer (z=0)
    if frame <= transfer_frames:
        theta = np.pi * frame / transfer_frames
        x = a_transfer * np.cos(theta) - (r2 - r1) / 2
        y = a_transfer * np.sin(theta)
        z = 0
        spacecraft.set_data([x], [y])
        spacecraft.set_3d_properties([z])
    else:
        spacecraft.set_data([], [])
        spacecraft.set_3d_properties([])

    return earth, mars, spacecraft

# Create animation
ani = FuncAnimation(fig, update, frames=num_frames, interval=50, blit=True)
plt.show()
