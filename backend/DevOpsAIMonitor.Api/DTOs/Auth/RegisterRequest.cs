namespace DevOpsAIMonitor.Api.DTOs.Auth
{
    public class RegisterRequest
    {
        public string FirstName { get; set; } = null!;
        public string LastName { get; set; } = null!;
        public string CompanyName { get; set; } = null!;
        public string Email { get; set; } = null!;
        public string PhoneNumber { get; set; } = null!;
        public string Password { get; set; } = null!;
    }
}
