using DevOpsAIMonitor.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace DevOpsAIMonitor.Api.Data
{
    public class ApplicationDbContext : DbContext
    {
        public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
        {
        }

        public DbSet<User> Users { get; set; } = null!;
    }
}
