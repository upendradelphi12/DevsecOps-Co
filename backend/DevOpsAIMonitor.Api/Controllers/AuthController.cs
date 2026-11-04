using BCrypt.Net;
using DevOpsAIMonitor.Api.Data;
using DevOpsAIMonitor.Api.DTOs.Auth;
using DevOpsAIMonitor.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace DevOpsAIMonitor.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly IConfiguration _configuration;

        public AuthController(ApplicationDbContext context, IConfiguration configuration)
        {
            _context = context;
            _configuration = configuration;
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register(RegisterRequest request)
        {
            if (await _context.Users.AnyAsync(u => u.Email.ToLower() == request.Email.ToLower()))
            {
                return BadRequest(new { message = "A user with this email already exists." });
            }

            var user = new User
            {
                FirstName = request.FirstName.Trim(),
                LastName = request.LastName.Trim(),
                CompanyName = request.CompanyName.Trim(),
                Email = request.Email.Trim().ToLower(),
                PhoneNumber = request.PhoneNumber.Trim(),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            };

            _context.Users.Add(user);
            await _context.SaveChangesAsync();

            return Ok(new { message = "Registration successful" });
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login(LoginRequest request)
        {
            var user = await _context.Users.SingleOrDefaultAsync(u => u.Email.ToLower() == request.Email.ToLower());
            if (user == null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            {
                return Unauthorized(new { message = "Invalid credentials" });
            }

            var token = GenerateJwtToken(user);
            return Ok(token);
        }

        private AuthResponse GenerateJwtToken(User user)
        {
            var jwtKey = _configuration["Jwt:Key"] ?? string.Empty;
            var jwtIssuer = _configuration["Jwt:Issuer"] ?? string.Empty;
            var tokenHandler = new JwtSecurityTokenHandler();
            var key = Encoding.UTF8.GetBytes(jwtKey);

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.Email),
                new(ClaimTypes.Role, user.Role),
                new(ClaimTypes.GivenName, user.FirstName),
                new(ClaimTypes.Surname, user.LastName)
            };

            var tokenDescriptor = new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(claims),
                Expires = DateTime.UtcNow.AddHours(1),
                Issuer = jwtIssuer,
                Audience = jwtIssuer,
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(key), SecurityAlgorithms.HmacSha256Signature)
            };

            var token = tokenHandler.CreateToken(tokenDescriptor);
            return new AuthResponse
            {
                Token = tokenHandler.WriteToken(token),
                RefreshToken = Guid.NewGuid().ToString(),
                ExpiresAt = tokenDescriptor.Expires ?? DateTime.UtcNow.AddHours(1)
            };
        }
    }
}
