import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D

# Set up the figure
fig = plt.figure(figsize=(10, 8))
ax = fig.add_subplot(111, projection='3d')

# Earth settings
earth_radius = 6371  # in km
u = np.linspace(0, 2 * np.pi, 100)
v = np.linspace(0, np.pi, 100)
x = earth_radius * np.outer(np.cos(u), np.sin(v))
y = earth_radius * np.outer(np.sin(u), np.sin(v))
z = earth_radius * np.outer(np.ones(np.size(u)), np.cos(v))
ax.plot_surface(x, y, z, color='blue', alpha=0.6, label='Earth')

# Orbital parameters for multiple orbits
orbits = [
    {"name": "LEO", "a": 6771, "e": 0.01, "color": "red"},   # 400 km altitude
    {"name": "MEO", "a": 20200, "e": 0.02, "color": "orange"}, # GPS altitude
    {"name": "GEO", "a": 42164, "e": 0.0, "color": "green"}      # Geostationary
]

theta = np.linspace(0, 2 * np.pi, 1000)

for orbit in orbits:
    a = orbit["a"]
    e = orbit["e"]
    b = a * np.sqrt(1 - e**2)
    r = (a * (1 - e**2)) / (1 + e * np.cos(theta))

    x = r * np.cos(theta) - a * e  # shift focus to Earth
    y = r * np.sin(theta)
    z = np.zeros_like(x)  # no inclination yet

    ax.plot3D(x, y, z, label=orbit["name"], color=orbit["color"])

max_radius = 45000  # bigger than biggest orbit radius
ax.set_xlim([-max_radius, max_radius])
ax.set_ylim([-max_radius, max_radius])
ax.set_zlim([-max_radius, max_radius])

# Labels and title
ax.set_xlabel("X (km)")
ax.set_ylabel("Y (km)")
ax.set_zlabel("Z (km)")
ax.set_title("3D Satellite Orbits Around Earth")
ax.legend()

plt.show()
